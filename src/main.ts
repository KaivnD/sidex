/*---------------------------------------------------------------------------------------------
 *  SideX Cloud IDE Entry Point
 *  Dedicated entry for web-based Cloud IDE mode
 *--------------------------------------------------------------------------------------------*/

import { loadNlsMessages } from './nls-loader.js';

async function boot() {
  // Load locale translations before any VS Code module imports
  await loadNlsMessages();

  const stages = [
    ['common', () => import('./vs/workbench/workbench.common.main.js')],
    ['web.main', () => import('./vs/workbench/browser/web.main.js')],
    ['web-dialog', () => import('./vs/workbench/browser/parts/dialogs/dialog.web.contribution.js')],
    ['web-services', () => import('./vs/workbench/workbench.web.main.js')],
  ] as const;

  for (const [label, loader] of stages) {
    try {
      await loader();
    } catch (e) {
      console.error(`[SideX Cloud] Barrel stage "${label}" failed:`, e);
      throw e;
    }
  }

  const { create } = await import('./vs/workbench/browser/web.factory.js');
  const { URI } = await import('./vs/base/common/uri.js');

  if (document.readyState === 'loading') {
    await new Promise<void>((r) => window.addEventListener('DOMContentLoaded', () => r()));
  }

  // Get workspaceId from global or URL
  const workspaceId = (globalThis as any).__SIDEX_CLOUD_WORKSPACE__ || 'default';
  const workspaceUri = URI.from({ scheme: 'cloud', authority: workspaceId, path: '/' });

  console.log(`[SideX Cloud] Opening workspace: ${workspaceId}`);
  console.log(`[SideX Cloud] Workspace URI: ${workspaceUri.toString()}`);

  const options: any = {
    initialColorTheme: {
      themeType: 'dark',
    },

    additionalTrustedDomains: ['https://github.com', 'https://*.github.com', 'https://*.githubusercontent.com'],

    workspaceProvider: {
      workspace: { folderUri: workspaceUri },
      trusted: true,
      open: async (_workspace: any, _options: any) => {
        if (_workspace && 'folderUri' in _workspace) {
          // Navigate to new workspace
          const newWorkspaceId = _workspace.folderUri.authority;
          window.location.href = `${window.location.pathname}?workspace=${newWorkspaceId}`;
        }
        return true;
      },
    },

    windowIndicator: {
      label: workspaceId,
      tooltip: `SideX Cloud IDE — workspace: ${workspaceId}`,
      command: undefined,
    },
  };

  await create(document.body, options);
}

boot().catch((err) => {
  console.error('[SideX Cloud] Boot failed:', err);
  document.body.innerHTML = `
    <div style="padding: 20px; color: #f33; font-family: monospace;">
      <h2>SideX Cloud IDE Failed to Start</h2>
      <pre>${err.message || err}</pre>
      <p>Make sure the Cloud IDE server is running on port 5945:</p>
      <code>cd cloud-server && npm run dev</code>
    </div>
  `;
});
