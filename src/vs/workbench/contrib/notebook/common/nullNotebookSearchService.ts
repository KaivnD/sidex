/*---------------------------------------------------------------------------------------------
 *  Null Notebook Search Service - placeholder for disabled notebook feature
 *--------------------------------------------------------------------------------------------*/

import { INotebookSearchService } from '../../search/common/notebookSearch.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ResourceSet } from '../../../../base/common/map.js';
import { ITextQuery, ISearchProgressItem, ISearchComplete } from '../../../services/search/common/search.js';

export class NullNotebookSearchService implements INotebookSearchService {
	readonly _serviceBrand = undefined;

	notebookSearch(
		query: ITextQuery,
		token: CancellationToken | undefined,
		searchInstanceID: string,
		onProgress?: (result: ISearchProgressItem) => void
	): {
		openFilesToScan: ResourceSet;
		completeData: Promise<ISearchComplete>;
		allScannedFiles: Promise<ResourceSet>;
	} {
		return {
			openFilesToScan: new ResourceSet(),
			completeData: Promise.resolve({ results: [], limitHit: false, messages: [] }),
			allScannedFiles: Promise.resolve(new ResourceSet()),
		};
	}
}
