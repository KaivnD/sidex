/**
 * SideX Cloud IDE Server - Bun Implementation
 * WebSocket-based file system provider with workspace isolation
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceRegistry, WorkspaceInfo } from './workspaceRegistry';

// Types matching VS Code file system provider interface
type FileType = 'file' | 'directory' | 'symlink';

// Chunk transfer configuration
const CHUNK_SIZE = 256 * 1024; // 256KB chunks for large file transfer

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

// Server configuration - use import.meta.dir to be location-independent
const SERVER_DIR = import.meta.dir;
const CONFIG_PATH = path.join(SERVER_DIR, 'config.json');
const registry = new WorkspaceRegistry(CONFIG_PATH);
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const DEFAULT_PORT = config.port || 5945;
const DEFAULT_HOST = config.host || 'localhost';

// Per-connection state
interface ConnectionContext {
  workspaceId: string;
  workspace: WorkspaceInfo;
  openFiles: Map<number, OpenFile>;
  nextFd: number;
  watchers: Map<string, WatcherInfo>;
  send: (data: any) => void;
  lastPing: number; // Last ping timestamp
  isAlive: boolean; // Connection health status
}

const connections = new Map<any, ConnectionContext>();
let nextGlobalFd = 1;

// Heartbeat configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds

// Start heartbeat checker
setInterval(() => {
  for (const [ws, ctx] of connections) {
    if (!ctx.isAlive) {
      console.log(`[Server] Connection timeout, closing: ${ctx.workspaceId}`);
      ws.close();
      continue;
    }
    ctx.isAlive = false;
    // Send ping frame (Bun WebSocket supports ping/pong natively)
    try {
      ws.ping();
    } catch {
      ctx.isAlive = false;
    }
  }
}, HEARTBEAT_INTERVAL);

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
      permissions: undefined,
    };
  }

  async readdir(relativePath: string): Promise<DirEntry[]> {
    const absPath = this.resolvePath(relativePath);
    if (!absPath) throw makeError('Invalid path', 'NoPermissions');

    const entries = await fs.promises.readdir(absPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
    }));
  }

  async readFile(relativePath: string): Promise<{ buffer: string; totalSize?: number; hasMore?: boolean }> {
    const absPath = this.resolvePath(relativePath);
    if (!absPath) throw makeError('Invalid path', 'NoPermissions');

    // Use Bun's optimized file reading
    const file = Bun.file(absPath);
    const stat = await file.stat();
    const content = Buffer.from(await file.arrayBuffer());

    // If file is larger than CHUNK_SIZE, return partial with hasMore flag
    if (content.length > CHUNK_SIZE) {
      return {
        buffer: bufferToBase64(content.slice(0, CHUNK_SIZE)),
        totalSize: content.length,
        hasMore: true,
      };
    }

    return { buffer: bufferToBase64(content) };
  }

  async readFileChunk(relativePath: string, offset: number, length: number): Promise<{ buffer: string }> {
    const absPath = this.resolvePath(relativePath);
    if (!absPath) throw makeError('Invalid path', 'NoPermissions');

    const file = Bun.file(absPath);
    const content = Buffer.from(await file.arrayBuffer());
    const chunk = content.slice(offset, Math.min(offset + length, content.length));

    return { buffer: bufferToBase64(chunk) };
  }

  async writeFile(
    relativePath: string,
    contentBase64: string,
    opts: { create?: boolean; overwrite?: boolean; append?: boolean; offset?: number },
  ): Promise<{ bytesWritten: number; needsMore?: boolean }> {
    const absPath = this.resolvePath(relativePath);
    if (!absPath) throw makeError('Invalid path', 'NoPermissions');

    const content = base64ToBuffer(contentBase64);

    // Check if file exists
    let exists = false;
    let currentSize = 0;
    try {
      const stat = await fs.promises.stat(absPath);
      exists = true;
      currentSize = stat.size;
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }

    if (exists && !opts.overwrite && !opts.create && !opts.append) {
      throw makeError('File exists', 'FileExists');
    }
    if (!exists && !opts.create) {
      throw makeError('File not found', 'FileNotFound');
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(absPath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    if (opts.append) {
      // Append mode for chunked uploads
      const fd = await fs.promises.open(absPath, exists ? 'a' : 'w');
      try {
        await fd.write(content, 0, content.length, opts.offset || currentSize);
        return { bytesWritten: content.length };
      } finally {
        await fd.close();
      }
    } else {
      // Single write mode
      await Bun.write(absPath, content);
      return { bytesWritten: content.length };
    }
  }

  async initWriteStream(relativePath: string, opts: { overwrite?: boolean }): Promise<{ streamId: string; ready: boolean }> {
    const absPath = this.resolvePath(relativePath);
    if (!absPath) throw makeError('Invalid path', 'NoPermissions');

    // Truncate file if overwrite requested
    if (opts.overwrite) {
      await Bun.write(absPath, '');
    }

    return { streamId: relativePath, ready: true };
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
      force: true,
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
      opts.create && opts.write
        ? fs.constants.O_CREAT | fs.constants.O_WRONLY
        : opts.read && opts.write
          ? fs.constants.O_RDWR
          : opts.write
            ? fs.constants.O_WRONLY
            : fs.constants.O_RDONLY;

    const handle = await fs.promises.open(absPath, flags);
    const fd = nextGlobalFd++;

    this.ctx.openFiles.set(fd, {
      fd,
      path: relativePath,
      handle,
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
      bytesRead,
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
        path: changePath,
      };

      // Broadcast to client
      this.ctx.send({
        type: 'fileChange',
        sessionId,
        changes: [change],
      });
    });

    this.ctx.watchers.set(key, {
      sessionId,
      watcher,
      req,
      path: relativePath,
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

  //#region Search Operations (using ripgrep)

  async searchFiles(
    relativePath: string,
    pattern: string,
    opts: {
      max_results: number;
      include: string[];
      exclude: string[];
    }
  ): Promise<{ path: string; name: string }[]> {
    const absPath = this.resolvePath(relativePath);
    if (!absPath) throw makeError('Invalid path', 'NoPermissions');

    // Build ripgrep args for file search
    const args = ['--files'];

    // Add pattern filtering if provided
    if (pattern) {
      args.push('--glob', pattern);
    }

    // Add include patterns
    for (const inc of opts.include) {
      args.push('--glob', inc);
    }

    // Add exclude patterns
    for (const exc of opts.exclude) {
      args.push('--glob', `!${exc}`);
    }

    // Limit results
    args.push('--max-count', String(opts.max_results));

    args.push(absPath);

    try {
      const proc = Bun.spawn(['rg', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      const files = output.trim().split('\n').filter(Boolean);

      return files.slice(0, opts.max_results).map(filePath => ({
        path: filePath,
        name: path.basename(filePath),
      }));
    } catch (err) {
      // ripgrep not installed or error - fallback to basic file listing
      console.warn('[Server] ripgrep failed, using fallback:', err);
      return this.fallbackFileSearch(absPath, pattern, opts);
    }
  }

  async searchText(
    relativePath: string,
    query: string,
    opts: {
      max_results: number;
      case_sensitive: boolean;
      is_regex: boolean;
      include: string[];
      exclude: string[];
    }
  ): Promise<{ path: string; line_number: number; line_content: string; column: number; match_length: number }[]> {
    const absPath = this.resolvePath(relativePath);
    if (!absPath) throw makeError('Invalid path', 'NoPermissions');

    // Build ripgrep args for text search
    const args = [
      '--json', // Output as JSON for easier parsing
      '--line-number',
      '--column',
    ];

    // Case sensitivity
    if (!opts.case_sensitive) {
      args.push('--ignore-case');
    }

    // Regex mode
    if (opts.is_regex) {
      args.push('--regexp', query);
    } else {
      args.push('--fixed-strings', query);
    }

    // Add include patterns
    for (const inc of opts.include) {
      args.push('--glob', inc);
    }

    // Add exclude patterns
    for (const exc of opts.exclude) {
      args.push('--glob', `!${exc}`);
    }

    // Limit results per file
    args.push('--max-count', String(Math.ceil(opts.max_results / 10)));

    args.push(absPath);

    try {
      const proc = Bun.spawn(['rg', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      const results: any[] = [];

      for (const line of output.trim().split('\n').filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            const data = parsed.data;
            for (const submatch of data.submatches) {
              results.push({
                path: data.path.text,
                line_number: data.line_number,
                line_content: data.lines.text.trimEnd(),
                column: submatch.start,
                match_length: submatch.end - submatch.start,
              });
            }
          }
        } catch {
          // Skip invalid JSON lines
        }
      }

      return results.slice(0, opts.max_results);
    } catch (err) {
      console.warn('[Server] ripgrep failed, using fallback:', err);
      return this.fallbackTextSearch(absPath, query, opts);
    }
  }

  private async fallbackFileSearch(
    absPath: string,
    pattern: string,
    opts: { max_results: number }
  ): Promise<{ path: string; name: string }[]> {
    const results: { path: string; name: string }[] = [];
    const glob = new Bun.Glob(pattern || '**/*');

    for await (const file of glob.scan({ cwd: absPath, absolute: true })) {
      if (results.length >= opts.max_results) break;
      results.push({ path: file, name: path.basename(file) });
    }

    return results;
  }

  private async fallbackTextSearch(
    absPath: string,
    query: string,
    opts: { max_results: number; case_sensitive: boolean }
  ): Promise<{ path: string; line_number: number; line_content: string; column: number; match_length: number }[]> {
    const results: any[] = [];
    const searchGlob = new Bun.Glob('**/*.{ts,js,json,md,txt,yml,yaml}');

    for await (const file of searchGlob.scan({ cwd: absPath, absolute: true })) {
      if (results.length >= opts.max_results) break;

      try {
        const content = await Bun.file(file).text();
        const lines = content.split('\n');
        const searchQuery = opts.case_sensitive ? query : query.toLowerCase();

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const searchLine = opts.case_sensitive ? line : line.toLowerCase();
          const index = searchLine.indexOf(searchQuery);

          if (index !== -1) {
            results.push({
              path: file,
              line_number: i + 1,
              line_content: line.trimEnd(),
              column: index,
              match_length: query.length,
            });

            if (results.length >= opts.max_results) break;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  //#endregion
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
      case 'readFileChunk':
        result = await ops.readFileChunk(msg.args[0], msg.args[1], msg.args[2]);
        break;
      case 'writeFile':
        result = await ops.writeFile(msg.args[0], msg.args[1], msg.args[2] || {});
        break;
      case 'initWriteStream':
        result = await ops.initWriteStream(msg.args[0], msg.args[1] || {});
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
      case 'searchFiles':
        result = await ops.searchFiles(msg.args[0], msg.args[1], msg.args[2]);
        break;
      case 'searchText':
        result = await ops.searchText(msg.args[0], msg.args[1], msg.args[2]);
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

// Bun server with WebSocket support
export function createSideXServer(port: number, host: string) {
  // Extensions directory
  const extensionsDir = path.resolve(import.meta.dir, '..', 'extensions');

  // Static file serving for extensions
  async function serveExtensions(req: Request, pathname: string): Promise<Response> {
    const filePath = path.join(extensionsDir, pathname.slice('/extensions/'.length));
    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();
      if (!exists) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(file);
    } catch (err) {
      return new Response(`Error: ${err}`, { status: 500 });
    }
  }

  return Bun.serve({
    port,
    hostname: host,

    fetch(req, server) {
      const url = new URL(req.url);

      // Extensions static files
      if (url.pathname.startsWith('/extensions/')) {
        return serveExtensions(req, url.pathname);
      }

      // WebSocket upgrade - pass URL in data
      if (url.pathname === '/' && server.upgrade(req, { data: { url: req.url } })) {
        return; // Upgraded to WebSocket
      }

      // Health check endpoint
      return new Response('SideX Cloud IDE Server - WebSocket endpoint available');
    },

    websocket: {
      open(ws) {
        const url = new URL(ws.data.url || '/', `http://${host}`);
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
          openFiles: new Map(),
          nextFd: 1,
          watchers: new Map(),
          send: (data) => ws.send(JSON.stringify(data)),
          lastPing: Date.now(),
          isAlive: true,
        };

        connections.set(ws, ctx);
        console.log(`[Server] Client connected to workspace: ${workspaceId} (${workspace.rootPath})`);
      },

      pong(ws) {
        const ctx = connections.get(ws);
        if (ctx) {
          ctx.isAlive = true;
          ctx.lastPing = Date.now();
        }
      },

      async message(ws, message) {
        const ctx = connections.get(ws);
        if (!ctx) return;

        try {
          const msg: RequestMessage = JSON.parse(message.toString());
          console.log(
            `[Server] ${msg.method}(${msg.args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a).slice(0, 50))).join(', ')})`,
          );
          const response = await handleRequest(ctx, msg);
          ws.send(JSON.stringify(response));
        } catch (err: any) {
          console.error('[Server] Error processing message:', err);
        }
      },

      close(ws) {
        const ctx = connections.get(ws);
        if (!ctx) return;

        console.log(`[Server] Client disconnected from workspace: ${ctx.workspaceId}`);
        connections.delete(ws);

        // Close any open files
        for (const [, openFile] of ctx.openFiles) {
          openFile.handle.close().catch(() => {});
        }

        // Close any watchers
        for (const [, watcher] of ctx.watchers) {
          watcher.watcher.close();
        }
      },

      perMessageDeflate: false,
    },

    error(error) {
      console.error('[Server] Error:', error);
      return new Response('Server Error', { status: 500 });
    },
  });
}

// Start server if run directly
if (import.meta.main) {
  const server = createSideXServer(DEFAULT_PORT, DEFAULT_HOST);

  console.log(`[Server] SideX Cloud IDE Server running at http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  console.log(`[Server] WebSocket endpoint: ws://${DEFAULT_HOST}:${DEFAULT_PORT}?workspaceId=<workspace-id>`);
  console.log(
    `[Server] Available workspaces: ${registry
      .getAll()
      .map((w) => w.workspaceId)
      .join(', ')}`,
  );

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
    server.stop();
    process.exit(0);
  });
}
