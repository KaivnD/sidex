/*---------------------------------------------------------------------------------------------
 *  SideX Cloud IDE - Hide Extensions View Contribution
 *  Removes the Extensions icon from Activity Bar at startup
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILogService } from '../../../../platform/log/common/log.js';

class HideExtensionsViewContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.hideExtensionsView';

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		this.hideExtensionsView();
	}

	private hideExtensionsView(): void {
		try {
			// Inject CSS to hide Extensions icon from Activity Bar
			const style = document.createElement('style');
			style.id = 'sidex-hide-extensions';
			style.textContent = `
				/* Hide Extensions icon in Activity Bar */
				.monaco-workbench .activitybar .monaco-action-bar .action-item[aria-label*="Extensions"],
				.monaco-workbench .activitybar .monaco-action-bar .action-item[aria-label="Extensions (⇧⌘X)"],
				.monaco-workbench .activitybar .monaco-action-bar .action-item[id*="extensions"],
				.monaco-workbench .activitybar .monaco-action-bar .action-item[data-viewlet-id="workbench.view.extensions"] {
					display: none !important;
				}
				/* Also hide by index if needed (Extensions is usually the 3rd item) */
				.monaco-workbench .activitybar .monaco-action-bar .actions-container .action-item:nth-child(3) {
					display: none !important;
				}
			`;
			document.head.appendChild(style);
			this.logService.info('[SideX Cloud] Extensions view hidden from Activity Bar via CSS injection');
		} catch (error) {
			this.logService.warn('[SideX Cloud] Failed to hide Extensions view:', error);
		}
	}
}

// Register the contribution to run after workbench is restored
registerWorkbenchContribution2(HideExtensionsViewContribution.ID, HideExtensionsViewContribution, WorkbenchPhase.AfterRestored);
