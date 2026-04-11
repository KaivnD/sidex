/*---------------------------------------------------------------------------------------------
 *  Null Notebook Service - placeholder for disabled notebook feature
 *--------------------------------------------------------------------------------------------*/

import { INotebookService, INotebookSerializer, SimpleNotebookProviderInfo, INotebookRendererInfo, INotebookStaticPreloadInfo, NotebookProviderInfo } from './notebookService.js';
import { INotebookContributionData, NotebookData, IOutputDto, IOrderedMimeType, NotebookCellTextModel } from './notebookCommon.js';
import { NotebookTextModel } from './model/notebookTextModel.js';
import { NotebookExtensionDescription } from './notebookCommon.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { VSBuffer, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { SnapshotContext } from '../../../../services/workingCopy/common/fileWorkingCopy.js';

export class NullNotebookService implements INotebookService {
	readonly _serviceBrand = undefined;

	onAddViewType = Event.None;
	onWillRemoveViewType = Event.None;
	onDidChangeOutputRenderers = Event.None;
	onWillAddNotebookDocument = Event.None;
	onDidAddNotebookDocument = Event.None;
	onWillRemoveNotebookDocument = Event.None;
	onDidRemoveNotebookDocument = Event.None;
	onNotebookDocumentSaved = Event.None;
	onNotebookDocumentWillSave = Event.None;

	// Basic methods
	canResolve(): Promise<boolean> { return Promise.resolve(false); }

	registerNotebookSerializer(): IDisposable { return { dispose: () => {} }; }

	withNotebookDataProvider(): Promise<SimpleNotebookProviderInfo> {
		throw new Error('Notebook functionality is disabled in SideX Cloud');
	}

	tryGetDataProviderSync(): SimpleNotebookProviderInfo | undefined { return undefined; }

	getOutputMimeTypeInfo(): readonly IOrderedMimeType[] { return []; }

	getViewTypeProvider(): string | undefined { return undefined; }

	getRendererInfo(): INotebookRendererInfo | undefined { return undefined; }

	getRenderers(): INotebookRendererInfo[] { return []; }

	getStaticPreloads(): Iterable<INotebookStaticPreloadInfo> { return []; }

	updateMimePreferredRenderer(): void { }

	saveMimeDisplayOrder(): void { }

	createNotebookTextModel(): Promise<NotebookTextModel> {
		throw new Error('Notebook functionality is disabled in SideX Cloud');
	}

	createNotebookTextDocumentSnapshot(): Promise<VSBufferReadableStream> {
		throw new Error('Notebook functionality is disabled in SideX Cloud');
	}

	restoreNotebookTextModelFromSnapshot(): Promise<NotebookTextModel> {
		throw new Error('Notebook functionality is disabled in SideX Cloud');
	}

	getNotebookTextModel(): NotebookTextModel | undefined { return undefined; }

	getNotebookTextModels(): Iterable<NotebookTextModel> { return []; }

	listNotebookDocuments(): readonly NotebookTextModel[] { return []; }

	registerContributedNotebookType(): IDisposable { return { dispose: () => {} }; }

	getContributedNotebookType(): NotebookProviderInfo | undefined { return undefined; }

	getContributedNotebookTypes(): readonly NotebookProviderInfo[] { return []; }

	hasSupportedNotebooks(): boolean { return false; }

	getNotebookProviderResourceRoots(): URI[] { return []; }

	setToCopy(): void { }

	getToCopy(): { items: NotebookCellTextModel[]; isCopy: boolean } | undefined { return undefined; }

	clearEditorCache(): void { }

	// Legacy methods that may be referenced
	getRegisteredNotebookProviders(): any[] { return []; }
	getRegisteredNotebookOutputRenderers(): any[] { return []; }
	getSupportedLanguages(): string[] { return []; }
	hasProvider(): boolean { return false; }
	getProvider(): any { return undefined; }
	getRenderer(): any { return undefined; }
	getRendererById(): any { return undefined; }
	getOrCreateNotebookDocument(): Promise<any> {
		throw new Error('Notebook functionality is disabled in SideX Cloud');
	}
	getNotebookDocumentFromModel(): any { return undefined; }
	getNotebookDocumentFromUri(): any { return undefined; }
	getNotebookDocumentFromCellResource(): any { return undefined; }
	getNotebookDocumentFromCellEditorModel(): any { return undefined; }
	getNotebookDocumentFromTextModel(): any { return undefined; }
	getNotebookDocumentFromTextBuffer(): any { return undefined; }
	getNotebookDocumentFromBackup(): any { return undefined; }
	getNotebookDocumentFromResource(): any { return undefined; }
}
