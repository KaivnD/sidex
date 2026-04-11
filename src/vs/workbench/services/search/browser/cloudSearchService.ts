/*---------------------------------------------------------------------------------------------
 *  SideX — WebSocket-based search provider for Cloud IDE.
 *  Delegates file search and text search to Bun server via WebSocket.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { Schemas } from '../../../../base/common/network.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import {
  IFileMatch,
  IFileQuery,
  ISearchComplete,
  ISearchProgressItem,
  ISearchResultProvider,
  ISearchService,
  ITextQuery,
  SearchProviderType,
  SearchRange,
} from '../common/search.js';
import { SearchService } from '../common/searchService.js';

interface ServerFileMatch {
  path: string;
  name: string;
}

interface ServerTextMatch {
  path: string;
  line_number: number;
  line_content: string;
  column: number;
  match_length: number;
}

interface SearchRequest {
  id: string;
  method: 'searchFiles' | 'searchText';
  args: any[];
}

interface SearchResponse {
  id: string;
  result?: any;
  error?: { message: string; code: string };
}

/**
 * Cloud search provider using WebSocket connection to Bun server
 */
class CloudSearchProvider extends Disposable implements ISearchResultProvider {
  private ws: WebSocket;
  private pendingRequests: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();
  private isConnected = false;
  private messageQueue: SearchRequest[] = [];

  constructor(
    private readonly workspaceId: string,
    private readonly serverUrl: string,
    private readonly logService: ILogService,
  ) {
    super();

    const wsUrl = `${serverUrl}?workspaceId=${workspaceId}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isConnected = true;
      this.logService.trace('[CloudSearch] Connected');

      // Flush queued messages
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        if (msg) this.ws.send(JSON.stringify(msg));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data: SearchResponse = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (err) {
        this.logService.error('[CloudSearch] Failed to parse message:', err);
      }
    };

    this.ws.onerror = (event) => {
      this.logService.error('[CloudSearch] WebSocket error:', event);
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.logService.trace('[CloudSearch] Disconnected');
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('WebSocket closed'));
      }
      this.pendingRequests.clear();
    };
  }

  private handleMessage(msg: SearchResponse): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) {
      // Not a response to our request (might be file change event)
      return;
    }

    this.pendingRequests.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private async request<T>(method: 'searchFiles' | 'searchText', args: any[]): Promise<T> {
    if (!this.isConnected) {
      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
        const check = () => {
          if (this.isConnected) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
    }

    const id = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const msg: SearchRequest = { id, method, args };
      const message = JSON.stringify(msg);

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(message);
      } else {
        this.messageQueue.push(msg);
      }
    });
  }

  async getAIName(): Promise<string | undefined> {
    return undefined;
  }

  async textSearch(
    query: ITextQuery,
    onProgress?: (p: ISearchProgressItem) => void,
    token?: CancellationToken,
  ): Promise<ISearchComplete> {
    const results: IFileMatch[] = [];
    let limitHit = false;

    for (const fq of query.folderQueries) {
      if (token?.isCancellationRequested) {
        break;
      }

      try {
        const matches = await this.request<ServerTextMatch[]>('searchText', [
          fq.folder.path,
          query.contentPattern.pattern,
          {
            max_results: query.maxResults ?? 500,
            case_sensitive: query.contentPattern.isCaseSensitive ?? false,
            is_regex: query.contentPattern.isRegExp ?? false,
            include: query.includePattern ? Object.keys(query.includePattern) : [],
            exclude: query.excludePattern ? Object.keys(query.excludePattern) : [],
          },
        ]);

        const byFile = new Map<string, ServerTextMatch[]>();
        for (const m of matches) {
          const arr = byFile.get(m.path);
          if (arr) {
            arr.push(m);
          } else {
            byFile.set(m.path, [m]);
          }
        }

        for (const [filePath, fileMatches] of byFile) {
          const resource = URI.file(filePath);
          const textResults = fileMatches.map((m) => {
            const line = m.line_number - 1;
            const start = m.column;
            const end = m.column + m.match_length;
            return {
              previewText: m.line_content,
              rangeLocations: [
                {
                  source: new SearchRange(line, start, line, end),
                  preview: new SearchRange(0, start, 0, end),
                },
              ],
            };
          });

          const fileMatch: IFileMatch = { resource, results: textResults };
          onProgress?.(fileMatch);
          results.push(fileMatch);
        }

        if (matches.length >= (query.maxResults ?? 500)) {
          limitHit = true;
        }
      } catch (err) {
        this.logService.error('[CloudSearch] textSearch failed:', err);
      }
    }

    return { results, limitHit, messages: [] };
  }

  async fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete> {
    const results: IFileMatch[] = [];
    let limitHit = false;

    for (const fq of query.folderQueries) {
      if (token?.isCancellationRequested) {
        break;
      }

      try {
        const matches = await this.request<ServerFileMatch[]>('searchFiles', [
          fq.folder.path,
          query.filePattern ?? '',
          {
            max_results: query.maxResults ?? 500,
            include: query.includePattern ? Object.keys(query.includePattern) : [],
            exclude: query.excludePattern ? Object.keys(query.excludePattern) : [],
          },
        ]);

        for (const m of matches) {
          results.push({ resource: URI.file(m.path) });
        }

        if (matches.length >= (query.maxResults ?? 500)) {
          limitHit = true;
        }
      } catch (err) {
        this.logService.error('[CloudSearch] fileSearch failed:', err);
      }
    }

    return { results, limitHit, messages: [] };
  }

  async clearCache(_cacheKey: string): Promise<void> {
    // Cloud search is stateless
  }

  override dispose(): void {
    super.dispose();
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

export class TauriSearchService extends SearchService {
  private provider: CloudSearchProvider | undefined;

  constructor(
    @IModelService modelService: IModelService,
    @IEditorService editorService: IEditorService,
    @ITelemetryService telemetryService: ITelemetryService,
    @ILogService logService: ILogService,
    @IExtensionService extensionService: IExtensionService,
    @IFileService fileService: IFileService,
    @IUriIdentityService uriIdentityService: IUriIdentityService,
  ) {
    super(modelService, editorService, telemetryService, logService, extensionService, fileService, uriIdentityService);

    // Get workspaceId and server URL from global config
    const workspaceId = (globalThis as any).__SIDEX_CLOUD_WORKSPACE__ || 'default';
    const serverUrl = `ws://${window.location.host}`;

    // Initialize provider for cloud scheme
    this.provider = this._register(new CloudSearchProvider(workspaceId, serverUrl, logService));
    this._register(this.registerSearchResultProvider('cloud', SearchProviderType.file, this.provider));
    this._register(this.registerSearchResultProvider('cloud', SearchProviderType.text, this.provider));
  }
}

registerSingleton(ISearchService, TauriSearchService, InstantiationType.Delayed);
