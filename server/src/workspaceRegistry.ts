/**
 * Workspace Registry - manages workspaceId → rootPath mappings
 */

import * as path from 'path';
import * as fs from 'fs';

export interface WorkspaceInfo {
	workspaceId: string;
	rootPath: string;
	createdAt: number;
	permissions: 'read' | 'write';
}

export interface Config {
	workspaces: Record<string, string>;
	port: number;
	host: string;
}

export class WorkspaceRegistry {
	private workspaces: Map<string, WorkspaceInfo> = new Map();
	private configPath: string;

	constructor(configPath: string) {
		this.configPath = configPath;
		this.load();
	}

	private load(): void {
		const config: Config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));

		for (const [workspaceId, rootPath] of Object.entries(config.workspaces)) {
			const absolutePath = path.resolve(rootPath);
			this.workspaces.set(workspaceId, {
				workspaceId,
				rootPath: absolutePath,
				createdAt: Date.now(),
				permissions: 'write'
			});

			// Ensure workspace directory exists
			if (!fs.existsSync(absolutePath)) {
				fs.mkdirSync(absolutePath, { recursive: true });
			}
		}

		console.log(`[WorkspaceRegistry] Loaded ${this.workspaces.size} workspaces`);
		for (const [id, info] of this.workspaces) {
			console.log(`  - ${id} → ${info.rootPath}`);
		}
	}

	get(workspaceId: string): WorkspaceInfo | undefined {
		return this.workspaces.get(workspaceId);
	}

	has(workspaceId: string): boolean {
		return this.workspaces.has(workspaceId);
	}

	/**
	 * Resolve a relative path to absolute path within workspace.
	 * Returns null if path escapes workspace root (security check).
	 */
	resolvePath(workspaceId: string, relativePath: string): string | null {
		const workspace = this.get(workspaceId);
		if (!workspace) {
			return null;
		}

		// Strip leading slash from URI path (cloud://default/.vscode -> .vscode)
		let normalizedRelative = relativePath;
		if (normalizedRelative.startsWith('/')) {
			normalizedRelative = normalizedRelative.slice(1);
		}

		// Normalize the path to prevent traversal attacks
		normalizedRelative = path.normalize(normalizedRelative);

		// Reject paths that try to escape workspace root
		if (normalizedRelative.startsWith('..') || path.isAbsolute(normalizedRelative)) {
			return null;
		}

		const absolutePath = path.join(workspace.rootPath, normalizedRelative);

		// Final check: ensure resolved path is still within workspace root
		if (!absolutePath.startsWith(workspace.rootPath)) {
			return null;
		}

		return absolutePath;
	}

	getAll(): WorkspaceInfo[] {
		return Array.from(this.workspaces.values());
	}
}