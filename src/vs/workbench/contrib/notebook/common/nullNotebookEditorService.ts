/*---------------------------------------------------------------------------------------------
 *  Null Notebook Editor Service - placeholder for disabled notebook feature
 *--------------------------------------------------------------------------------------------*/

import { INotebookEditorService, IBorrowValue } from '../browser/services/notebookEditorService.js';
import { INotebookEditor } from '../browser/notebookBrowser.js';
import { NotebookEditorWidget } from '../browser/notebookEditorWidget.js';
import { URI } from '../../../../base/common/uri.js';
import { Event } from '../../../../base/common/event.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { Dimension } from '../../../../base/browser/dom.js';

export class NullNotebookEditorService implements INotebookEditorService {
	readonly _serviceBrand = undefined;

	onDidAddNotebookEditor = Event.None;
	onDidRemoveNotebookEditor = Event.None;

	retrieveWidget(): IBorrowValue<INotebookEditor> {
		return { value: undefined };
	}

	retrieveExistingWidgetFromURI(): IBorrowValue<NotebookEditorWidget> | undefined {
		return undefined;
	}

	retrieveAllExistingWidgets(): IBorrowValue<NotebookEditorWidget>[] {
		return [];
	}

	addNotebookEditor(): void { }

	removeNotebookEditor(): void { }

	getNotebookEditor(): INotebookEditor | undefined {
		return undefined;
	}

	listNotebookEditors(): readonly INotebookEditor[] {
		return [];
	}

	getNotebookForPossibleCell(): INotebookEditor | undefined {
		return undefined;
	}

	updateReplContextKey(): void { }
}
