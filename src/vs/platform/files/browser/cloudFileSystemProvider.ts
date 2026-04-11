/*---------------------------------------------------------------------------------------------
 *  SideX — Cloud IDE file system provider.
 *  Handles `cloud://workspaceId/path` URIs by delegating all I/O to a
 *  Node.js WebSocket server that manages workspace file systems.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import {
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	FileType,
	createFileSystemProviderError,
	IFileChange,
	IFileDeleteOptions,
	IFileOpenOptions,
	IFileOverwriteOptions,
	IFileWriteOptions,
	IStat,
	IWatchOptions,
	IFileSystemProviderWithFileReadWriteCapability,
	IFileSystemProviderWithOpenReadWriteCloseCapability,
	IFileSystemProviderWithFileFolderCopyCapability,
	FilePermission,
} from '../common/files.js';

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

interface FileChangeBroadcast {
	type: 'fileChange';
	sessionId: string;
	changes: FileChangeEvent[];
}

interface PendingRequest {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
}

interface OpenFile {
	fd: number;
	path: string;
}

export class CloudFileSystemProvider extends Disposable implements
	IFileSystemProviderWithFileReadWriteCapability,
	IFileSystemProviderWithOpenReadWriteCloseCapability,
	IFileSystemProviderWithFileFolderCopyCapability {

	readonly capabilities: FileSystemProviderCapabilities =
		FileSystemProviderCapabilities.FileReadWrite |
		FileSystemProviderCapabilities.FileOpenReadWriteClose |
		FileSystemProviderCapabilities.FileFolderCopy |
		FileSystemProviderCapabilities.PathCaseSensitive;

	readonly onDidChangeCapabilities = Event.None;

	private readonly _onDidChangeFile = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile = this._onDidChangeFile.event;

	private readonly _onDidWatchError = this._register(new Emitter<string>());
	readonly onDidWatchError = this._onDidWatchError.event;

	private ws: WebSocket;
	private pendingRequests: Map<string, PendingRequest> = new Map();
	private openFiles: Map<number, OpenFile> = new Map();
	private watchSessionId = generateUuid();
	private isConnected = false;

	constructor(wsUrl: string) {
		super();

		this.ws = new WebSocket(wsUrl);

		this.ws.onopen = () => {
			this.isConnected = true;
			console.log('[CloudFS] WebSocket connected');
		};

		this.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				this.handleMessage(data);
			} catch (err) {
				console.error('[CloudFS] Failed to parse message:', err);
			}
		};

		this.ws.onerror = (event) => {
			console.error('[CloudFS] WebSocket error:', event);
		};

		this.ws.onclose = () => {
			this.isConnected = false;
			console.log('[CloudFS] WebSocket closed');
			// Reject all pending requests
			for (const [, pending] of this.pendingRequests) {
				pending.reject(createFileSystemProviderError('WebSocket closed', FileSystemProviderErrorCode.Unknown));
			}
			this.pendingRequests.clear();
		};

		// Note: Browser WebSocket automatically responds to server ping with pong
		// We just need to listen for connection issues
		this._register(toDisposable(() => {
			if (this.ws.readyState === WebSocket.OPEN) {
				this.ws.close();
			}
		}));
	}

	private handleMessage(data: ResponseMessage | FileChangeBroadcast): void {
		// Handle file change broadcast (has 'type' field)
		if ('type' in data && data.type === 'fileChange') {
			const changeData = data as FileChangeBroadcast;
			const changes: IFileChange[] = changeData.changes.map(c => ({
				resource: URI.from({ scheme: 'cloud', path: c.path }),
				type: c.type === 'created' ? 1 : c.type === 'changed' ? 0 : 2
			}));
			this._onDidChangeFile.fire(changes);
			return;
		}

		// Handle request response (has 'id' field)
		const msg = data as ResponseMessage;
		if (!msg.id) {
			console.warn('[CloudFS] Received message without id:', data);
			return;
		}

		const pending = this.pendingRequests.get(msg.id);
		if (!pending) {
			console.warn('[CloudFS] Unknown request ID:', msg.id);
			return;
		}

		this.pendingRequests.delete(msg.id);

		if (msg.error) {
			const errorMsg = msg.error.message || 'Unknown error';
			const code = this.mapErrorCode(msg.error.code);
			pending.reject(createFileSystemProviderError(errorMsg, code));
		} else {
			pending.resolve(msg.result);
		}
	}

	private mapErrorCode(code: string): FileSystemProviderErrorCode {
		switch (code) {
			case 'FileNotFound': return FileSystemProviderErrorCode.FileNotFound;
			case 'FileExists': return FileSystemProviderErrorCode.FileExists;
			case 'NoPermissions': return FileSystemProviderErrorCode.NoPermissions;
			case 'FileNotDirectory': return FileSystemProviderErrorCode.FileNotADirectory;
			case 'FileIsDirectory': return FileSystemProviderErrorCode.FileIsADirectory;
			default: return FileSystemProviderErrorCode.Unknown;
		}
	}

	private async request<T>(method: string, args: any[]): Promise<T> {
		if (!this.isConnected && this.ws.readyState !== WebSocket.OPEN) {
			// Wait for connection
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
				this.ws.onopen = () => {
					clearTimeout(timeout);
					this.isConnected = true;
					resolve();
				};
				this.ws.onerror = () => {
					clearTimeout(timeout);
					reject(new Error('Connection failed'));
				};
			});
		}

		const id = generateUuid();

		return new Promise<T>((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });

			const msg: RequestMessage = { id, method, args };
			this.ws.send(JSON.stringify(msg));
		});
	}

	/**
	 * Extracts the relative path from a cloud:// URI.
	 * cloud://workspaceId/path/to/file → path/to/file
	 */
	private static toRelativePath(resource: URI): string {
		return resource.path;
	}

	//#region File Metadata

	async stat(resource: URI): Promise<IStat> {
		const result = await this.request<{
			type: 'file' | 'directory' | 'symlink';
			size: number;
			mtime: number;
			ctime: number;
			permissions?: 'readonly';
		}>('stat', [CloudFileSystemProvider.toRelativePath(resource)]);

		let type: FileType;
		switch (result.type) {
			case 'directory': type = FileType.Directory; break;
			case 'symlink': type = FileType.SymbolicLink; break;
			default: type = FileType.File;
		}

		return {
			type,
			size: result.size,
			mtime: result.mtime,
			ctime: result.ctime,
			permissions: result.permissions === 'readonly' ? FilePermission.Readonly : undefined
		};
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const entries = await this.request<{ name: string; type: 'file' | 'directory' | 'symlink' }[]>('readdir', [CloudFileSystemProvider.toRelativePath(resource)]);
		return entries.map(e => {
			let type: FileType;
			switch (e.type) {
				case 'directory': type = FileType.Directory; break;
				case 'symlink': type = FileType.SymbolicLink; break;
				default: type = FileType.File;
			}
			return [e.name, type];
		});
	}

	//#endregion

	//#region File Reading/Writing

	async readFile(resource: URI): Promise<Uint8Array> {
		const relativePath = CloudFileSystemProvider.toRelativePath(resource);
		const result = await this.request<{
			buffer: string;
			totalSize?: number;
			hasMore?: boolean;
		}>('readFile', [relativePath]);

		// If file fits in single chunk, return directly
		if (!result.hasMore) {
			return this.base64ToUint8Array(result.buffer);
		}

		// Large file: accumulate chunks
		const firstChunk = this.base64ToUint8Array(result.buffer);
		const totalSize = result.totalSize!;
		const chunks: Uint8Array[] = [firstChunk];
		let received = firstChunk.length;

		// Fetch remaining chunks
		const CHUNK_SIZE = 256 * 1024; // Must match server CHUNK_SIZE
		while (received < totalSize) {
			const chunkResult = await this.request<{ buffer: string }>(
				'readFileChunk',
				[relativePath, received, CHUNK_SIZE]
			);
			const chunk = this.base64ToUint8Array(chunkResult.buffer);
			chunks.push(chunk);
			received += chunk.length;

			// Safety check
			if (chunk.length === 0) break;
		}

		// Combine all chunks
		const combined = new Uint8Array(totalSize);
		let offset = 0;
		for (const chunk of chunks) {
			combined.set(chunk, offset);
			offset += chunk.length;
		}
		return combined;
	}

	async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		const relativePath = CloudFileSystemProvider.toRelativePath(resource);
		const CHUNK_SIZE = 256 * 1024; // 256KB chunks

		// Small file: single write
		if (content.length <= CHUNK_SIZE) {
			await this.request('writeFile', [
				relativePath,
				this.uint8ArrayToBase64(content),
				{ create: opts.create, overwrite: opts.overwrite }
			]);
			return;
		}

		// Large file: chunked upload
		// Initialize write stream
		await this.request('initWriteStream', [
			relativePath,
			{ overwrite: opts.overwrite }
		]);

		// Upload chunks
		let offset = 0;
		while (offset < content.length) {
			const chunk = content.slice(offset, Math.min(offset + CHUNK_SIZE, content.length));
			await this.request('writeFile', [
				relativePath,
				this.uint8ArrayToBase64(chunk),
				{ create: offset === 0, append: true, offset }
			]);
			offset += chunk.length;
		}
	}

	//#endregion

	//#region Open/Read/Write/Close

	async open(resource: URI, opts: IFileOpenOptions): Promise<number> {
		const fd = await this.request<number>('open', [
			CloudFileSystemProvider.toRelativePath(resource),
			{ create: opts.create, write: opts.create ?? false, read: true }
		]);

		this.openFiles.set(fd, { fd, path: CloudFileSystemProvider.toRelativePath(resource) });
		return fd;
	}

	async close(fd: number): Promise<void> {
		await this.request('close', [fd]);
		this.openFiles.delete(fd);
	}

	async read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		const result = await this.request<{ buffer: string; bytesRead: number }>('read', [fd, pos, length]);
		const buffer = this.base64ToUint8Array(result.buffer);
		data.set(buffer.slice(0, result.bytesRead), offset);
		return result.bytesRead;
	}

	async write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		const bytesWritten = await this.request<number>('write', [
			fd,
			pos,
			this.uint8ArrayToBase64(data.slice(offset, offset + length))
		]);
		return bytesWritten;
	}

	//#endregion

	//#region Directory Operations

	async mkdir(resource: URI): Promise<void> {
		await this.request('mkdir', [CloudFileSystemProvider.toRelativePath(resource), { recursive: true }]);
	}

	async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		await this.request('delete', [CloudFileSystemProvider.toRelativePath(resource), { recursive: opts.recursive }]);
	}

	async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
		await this.request('rename', [
			CloudFileSystemProvider.toRelativePath(from),
			CloudFileSystemProvider.toRelativePath(to),
			{ overwrite: opts.overwrite }
		]);
	}

	async copy(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
		await this.request('copy', [
			CloudFileSystemProvider.toRelativePath(from),
			CloudFileSystemProvider.toRelativePath(to),
			{ overwrite: opts.overwrite }
		]);
	}

	//#endregion

	//#region File Watching

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		const req = generateUuid();

		// Fire and forget - we don't wait for confirmation
		this.request('watch', [
			this.watchSessionId,
			req,
			CloudFileSystemProvider.toRelativePath(resource),
			{ recursive: opts.recursive }
		]).catch(err => {
			console.error('[CloudFS] Watch failed:', err);
		});

		return toDisposable(() => {
			this.request('unwatch', [this.watchSessionId, req]).catch(() => {});
		});
	}

	//#endregion

	//#region Helpers

	private uint8ArrayToBase64(data: Uint8Array): string {
		// Convert Uint8Array to base64 string
		let binary = '';
		for (let i = 0; i < data.length; i++) {
			binary += String.fromCharCode(data[i]);
		}
		return btoa(binary);
	}

	private base64ToUint8Array(base64: string): Uint8Array {
		// Convert base64 string to Uint8Array
		const binary = atob(base64);
		const data = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			data[i] = binary.charCodeAt(i);
		}
		return data;
	}

	//#endregion
}
