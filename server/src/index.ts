/**
 * SideX Cloud IDE Server
 * WebSocket-based file system provider with workspace isolation
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { WorkspaceRegistry, WorkspaceInfo } from './workspaceRegistry.js';

// Types matching VS Code file system provider interface
type FileType = 'file' | 'directory' | 'symlink';
interface FileStat {
	type: FileType;
	size: number;
	mtime: number;
	ctime: number;
	permissions?: 'readonly';
}

interface DirEntry {
	name: string;
	type: FileType;
}

interface RequestMessage {
	id: string;
	method: string;
	args: any[];
}

interface ResponseMessage {
	id: string;
	result?: any;
	error?: { message: string; code: string };
}

interface FileChangeEvent {
	type: 'created' | 'changed' | 'deleted';
	path: string;
}

// Open file tracking
interface OpenFile {
	fd: number;
	path: string;
	handle: fs.promises.FileHandle;
}

interface WatcherInfo {
	sessionId: string;
	watcher: fs.FSWatcher;
	req: string;
	path: string;
}

// Server configuration
const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const registry = new WorkspaceRegistry(CONFIG_PATH);
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const PORT = config.port || 5945;
const HOST = config.host || 'localhost';

// Per-connection state
interface ConnectionContext {
	workspaceId: string;
	workspace: WorkspaceInfo;
	ws: WebSocket;
	openFiles: Map<number, OpenFile>;
	nextFd: number;
	watchers: Map<string, WatcherInfo>;
}

const connections: Map<WebSocket, ConnectionContext> = new Map();
let nextGlobalFd = 1;

// Error code mapping
function getErrorCode(err: any): string {
	if (err.code === 'ENOENT') return 'FileNotFound';
	if (err.code === 'EEXIST') return 'FileExists';
	if (err.code === 'EACCES' || err.code === 'EPERM') return 'NoPermissions';
	if (err.code === 'ENOTDIR') return 'FileNotDirectory';
	if (err.code === 'EISDIR') return 'FileIsDirectory';
	return 'Unknown';
}

function makeError(message: string, code: string): { message: string; code: string } {
	return { message, code };
}

// File type detection
function getFileType(stat: fs.Stats): FileType {
	if (stat.isDirectory()) return 'directory';
	if (stat.isSymbolicLink()) return 'symlink';
	return 'file';
}

// Base64 encoding/decoding for binary data
function bufferToBase64(buffer: Buffer): string {
	return buffer.toString('base64');
}

function base64ToBuffer(base64: string): Buffer {
	return Buffer.from(base64, 'base64');
}

// File operations implementation
class FileOperations {
	constructor(private ctx: ConnectionContext) {}

	private resolvePath(relativePath: string): string | null {
		return registry.resolvePath(this.ctx.workspaceId, relativePath);
	}

	async stat(relativePath: string): Promise<FileStat> {
		const absPath = this.resolvePath(relativePath);
		if (!absPath) throw makeError('Invalid path', 'NoPermissions');

		const stat = await fs.promises.stat(absPath);
		return {
			type: getFileType(stat),
			size: stat.size,
			mtime: stat.mtimeMs,
			ctime: stat.ctimeMs,
			permissions: undefined
		};
	}

	async readdir(relativePath: string): Promise<DirEntry[]> {
		const absPath = this.resolvePath(relativePath);
		if (!absPath) throw makeError('Invalid path', 'NoPermissions');

		const entries = await fs.promises.readdir(absPath, { withFileTypes: true });
		return entries.map(entry => ({
			name: entry.name,
			type: entry.isDirectory() ? 'directory' :
				  entry.isSymbolicLink() ? 'symlink' : 'file'
		}));
	}

	async readFile(relativePath: string): Promise<{ buffer: string }> {
		const absPath = this.resolvePath(relativePath);
		if (!absPath) throw makeError('Invalid path', 'NoPermissions');

		const content = await fs.promises.readFile(absPath);
		return { buffer: bufferToBase64(content) };
	}

	async writeFile(relativePath: string, contentBase64: string, opts: { create?: boolean; overwrite?: boolean }): Promise<void> {
		const absPath = this.resolvePath(relativePath);
		if (!absPath) throw makeError('Invalid path', 'NoPermissions');

		const content = base64ToBuffer(contentBase64);

		// Check if file exists
		let exists = false;
		try {
			await fs.promises.stat(absPath);
			exists = true;
		} catch (e: any) {
			if (e.code !== 'ENOENT') throw e;
		}

		if (exists && !opts.overwrite && !opts.create) {
			throw makeError('File exists', 'FileExists');
		}
		if (!exists && !opts.create) {
			throw makeError('File not found', 'FileNotFound');
		}

		// Ensure parent directory exists
		const parentDir = path.dirname(absPath);
		await fs.promises.mkdir(parentDir, { recursive: true });

		await fs.promises.writeFile(absPath, content);
	}

	async mkdir(relativePath: string, opts: { recursive?: boolean }): Promise<void> {
		const absPath = this.resolvePath(relativePath);
		if (!absPath) throw makeError('Invalid path', 'NoPermissions');

		await fs.promises.mkdir(absPath, { recursive: opts.recursive ?? true });
	}

	async delete(relativePath: string, opts: { recursive?: boolean }): Promise<void> {
		const absPath = this.resolvePath(relativePath);
		if (!absPath) throw makeError('Invalid path', 'NoPermissions');

		await fs.promises.rm(absPath, {
			recursive: opts.recursive ?? true,
			force: true
		});
	}

	async rename(fromPath: string, toPath: string, opts: { overwrite?: boolean }): Promise<void> {
		const absFrom = this.resolvePath(fromPath);
		const absTo = this.resolvePath(toPath);
		if (!absFrom || !absTo) throw makeError('Invalid path', 'NoPermissions');

		// Check if target exists
		if (!opts.overwrite) {
			try {
				await fs.promises.stat(absTo);
				throw makeError('Target exists', 'FileExists');
			} catch (e: any) {
				if (e.code !== 'ENOENT') throw e;
			}
		}

		await fs.promises.rename(absFrom, absTo);
	}

	async copy(fromPath: string, toPath: string, opts: { overwrite?: boolean }): Promise<void> {
		const absFrom = this.resolvePath(fromPath);
		const absTo = this.resolvePath(toPath);
		if (!absFrom || !absTo) throw makeError('Invalid path', 'NoPermissions');

		// Check if target exists
		if (!opts.overwrite) {
			try {
				await fs.promises.stat(absTo);
				throw makeError('Target exists', 'FileExists');
			} catch (e: any) {
				if (e.code !== 'ENOENT') throw e;
			}
		}

		// Ensure parent directory exists for target
		const parentDir = path.dirname(absTo);
		await fs.promises.mkdir(parentDir, { recursive: true });

		await fs.promises.copyFile(absFrom, absTo);
	}

	async open(relativePath: string, opts: { create?: boolean; write?: boolean; read?: boolean }): Promise<number> {
		const absPath = this.resolvePath(relativePath);
		if (!absPath) throw makeError('Invalid path', 'NoPermissions');

		const flags: number =
			(opts.create && opts.write ? fs.constants.O_CREAT | fs.constants.O_WRONLY :
			 opts.read && opts.write ? fs.constants.O_RDWR :
			 opts.write ? fs.constants.O_WRONLY :
			 fs.constants.O_RDONLY);

		const handle = await fs.promises.open(absPath, flags);
		const fd = nextGlobalFd++;

		this.ctx.openFiles.set(fd, {
			fd,
			path: relativePath,
			handle
		});

		return fd;
	}

	async close(fd: number): Promise<void> {
		const openFile = this.ctx.openFiles.get(fd);
		if (!openFile) throw makeError('Invalid file descriptor', 'Unknown');

		await openFile.handle.close();
		this.ctx.openFiles.delete(fd);
	}

	async read(fd: number, pos: number, length: number): Promise<{ buffer: string; bytesRead: number }> {
		const openFile = this.ctx.openFiles.get(fd);
		if (!openFile) throw makeError('Invalid file descriptor', 'Unknown');

		const buffer = Buffer.alloc(length);
		const { bytesRead } = await openFile.handle.read(buffer, 0, length, pos);

		return {
			buffer: bufferToBase64(buffer.slice(0, bytesRead)),
			bytesRead
		};
	}

	async write(fd: number, pos: number, contentBase64: string): Promise<number> {
		const openFile = this.ctx.openFiles.get(fd);
		if (!openFile) throw makeError('Invalid file descriptor', 'Unknown');

		const content = base64ToBuffer(contentBase64);
		const { bytesWritten } = await openFile.handle.write(content, 0, content.length, pos);

		return bytesWritten;
	}

	async watch(sessionId: string, req: string, relativePath: string, opts: { recursive?: boolean }): Promise<void> {
		const absPath = this.resolvePath(relativePath);
		if (!absPath) throw makeError('Invalid path', 'NoPermissions');

		const key = `${sessionId}:${req}`;

		// Stop existing watcher for this request
		const existing = this.ctx.watchers.get(key);
		if (existing) {
			existing.watcher.close();
			this.ctx.watchers.delete(key);
		}

		// Only watch if path exists
		try {
			await fs.promises.stat(absPath);
		} catch {
			// Path doesn't exist, silently ignore (no error, just don't watch)
			return;
		}

		const watcher = fs.watch(absPath, { recursive: opts.recursive ?? false }, (event, filename) => {
			if (!filename) return;

			const changePath = path.join(relativePath, filename);
			const change: FileChangeEvent = {
				type: event === 'rename' ? 'created' : 'changed',
				path: changePath
			};

			// Broadcast to client
			this.ctx.ws.send(JSON.stringify({
				type: 'fileChange',
				sessionId,
				changes: [change]
			}));
		});

		this.ctx.watchers.set(key, {
			sessionId,
			watcher,
			req,
			path: relativePath
		});
	}

	async unwatch(sessionId: string, req: string): Promise<void> {
		const key = `${sessionId}:${req}`;
		const watcher = this.ctx.watchers.get(key);
		if (watcher) {
			watcher.watcher.close();
			this.ctx.watchers.delete(key);
		}
	}
}

// Handle incoming request
async function handleRequest(ctx: ConnectionContext, msg: RequestMessage): Promise<ResponseMessage> {
	const ops = new FileOperations(ctx);

	try {
		let result: any;

		switch (msg.method) {
			case 'stat':
				result = await ops.stat(msg.args[0]);
				break;
			case 'readdir':
				result = await ops.readdir(msg.args[0]);
				break;
			case 'readFile':
				result = await ops.readFile(msg.args[0]);
				break;
			case 'writeFile':
				result = await ops.writeFile(msg.args[0], msg.args[1], msg.args[2] || {});
				break;
			case 'mkdir':
				result = await ops.mkdir(msg.args[0], msg.args[1] || {});
				break;
			case 'delete':
				result = await ops.delete(msg.args[0], msg.args[1] || {});
				break;
			case 'rename':
				result = await ops.rename(msg.args[0], msg.args[1], msg.args[2] || {});
				break;
			case 'copy':
				result = await ops.copy(msg.args[0], msg.args[1], msg.args[2] || {});
				break;
			case 'open':
				result = await ops.open(msg.args[0], msg.args[1] || {});
				break;
			case 'close':
				result = await ops.close(msg.args[0]);
				break;
			case 'read':
				result = await ops.read(msg.args[0], msg.args[1], msg.args[2]);
				break;
			case 'write':
				result = await ops.write(msg.args[0], msg.args[1], msg.args[2]);
				break;
			case 'watch':
				result = await ops.watch(msg.args[0], msg.args[1], msg.args[2], msg.args[3] || {});
				break;
			case 'unwatch':
				result = await ops.unwatch(msg.args[0], msg.args[1]);
				break;
			default:
				throw makeError(`Unknown method: ${msg.method}`, 'Unknown');
		}

		return { id: msg.id, result };
	} catch (err: any) {
		const message = err.message || String(err);
		const code = getErrorCode(err);
		return { id: msg.id, error: { message, code } };
	}
}

// WebSocket connection handler
function onConnection(ws: WebSocket, req: http.IncomingMessage) {
	// Extract workspaceId from URL query parameter
	const url = new URL(req.url || '/', `http://${HOST}`);
	const workspaceId = url.searchParams.get('workspaceId');

	if (!workspaceId) {
		console.error('[Server] Missing workspaceId parameter');
		ws.send(JSON.stringify({ error: { message: 'Missing workspaceId', code: 'NoPermissions' } }));
		ws.close();
		return;
	}

	const workspace = registry.get(workspaceId);
	if (!workspace) {
		console.error(`[Server] Unknown workspaceId: ${workspaceId}`);
		ws.send(JSON.stringify({ error: { message: `Unknown workspace: ${workspaceId}`, code: 'NoPermissions' } }));
		ws.close();
		return;
	}

	const ctx: ConnectionContext = {
		workspaceId,
		workspace,
		ws,
		openFiles: new Map(),
		nextFd: 1,
		watchers: new Map()
	};

	connections.set(ws, ctx);
	console.log(`[Server] Client connected to workspace: ${workspaceId} (${workspace.rootPath})`);

	ws.on('message', async (data: RawData) => {
		try {
			const msg: RequestMessage = JSON.parse(data.toString());
			console.log(`[Server] ${msg.method}(${msg.args.map(a => typeof a === 'string' ? a : JSON.stringify(a).slice(0, 50)).join(', ')})`);
			const response = await handleRequest(ctx, msg);
			ws.send(JSON.stringify(response));
		} catch (err: any) {
			console.error('[Server] Error processing message:', err);
		}
	});

	ws.on('close', () => {
		console.log(`[Server] Client disconnected from workspace: ${workspaceId}`);
		connections.delete(ws);

		// Close any open files
		for (const [, openFile] of ctx.openFiles) {
			openFile.handle.close().catch(() => {});
		}

		// Close any watchers
		for (const [, watcher] of ctx.watchers) {
			watcher.watcher.close();
		}
	});

	ws.on('error', (err) => {
		console.error(`[Server] WebSocket error for ${workspaceId}:`, err);
	});
}

// Create HTTP server
const server = http.createServer((req, res) => {
	res.writeHead(200, { 'Content-Type': 'text/plain' });
	res.end('SideX Cloud IDE Server - WebSocket endpoint available');
});

// Create WebSocket server
const wss = new WebSocketServer({ server });
wss.on('connection', onConnection);

// Start server
server.listen(PORT, HOST, () => {
	console.log(`[Server] SideX Cloud IDE Server running at http://${HOST}:${PORT}`);
	console.log(`[Server] WebSocket endpoint: ws://${HOST}:${PORT}?workspaceId=<workspace-id>`);
	console.log(`[Server] Available workspaces: ${registry.getAll().map(w => w.workspaceId).join(', ')}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
	console.log('\n[Server] Shutting down...');
	for (const [ws, ctx] of connections) {
		ws.close();
		for (const [, openFile] of ctx.openFiles) {
			openFile.handle.close().catch(() => {});
		}
		for (const [, watcher] of ctx.watchers) {
			watcher.watcher.close();
		}
	}
	server.close();
	process.exit(0);
});