/*---------------------------------------------------------------------------------------------
 *  Null Notebook Contribution - Registers null services for disabled notebook feature
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { INotebookService } from './notebookService.js';
import { INotebookEditorModelResolverService } from './notebookEditorModelResolverService.js';
import { INotebookEditorService } from '../browser/services/notebookEditorService.js';
import { INotebookSearchService } from '../../search/common/notebookSearch.js';
import { NullNotebookService } from './nullNotebookService.js';
import { NullNotebookEditorModelResolverService } from './nullNotebookEditorModelResolverService.js';
import { NullNotebookEditorService } from './nullNotebookEditorService.js';
import { NullNotebookSearchService } from './nullNotebookSearchService.js';

// Register null notebook services
registerSingleton(INotebookService, NullNotebookService, InstantiationType.Delayed);
registerSingleton(INotebookEditorModelResolverService, NullNotebookEditorModelResolverService, InstantiationType.Delayed);
registerSingleton(INotebookEditorService, NullNotebookEditorService, InstantiationType.Delayed);
registerSingleton(INotebookSearchService, NullNotebookSearchService, InstantiationType.Delayed);
