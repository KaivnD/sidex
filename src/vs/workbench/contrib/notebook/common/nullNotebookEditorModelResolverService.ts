/*---------------------------------------------------------------------------------------------
 *  Null Notebook Editor Model Resolver Service - placeholder for disabled notebook feature
 *--------------------------------------------------------------------------------------------*/

import { INotebookEditorModelResolverService } from './notebookEditorModelResolverService.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IResolvedNotebookEditorModel } from './notebookCommon.js';

export class NullNotebookEditorModelResolverService implements INotebookEditorModelResolverService {
	readonly _serviceBrand = undefined;

	async resolve(resource: URI, viewType?: string, token?: CancellationToken): Promise<IResolvedNotebookEditorModel> {
		throw new Error('Notebook functionality is disabled in SideX Cloud');
	}
}
