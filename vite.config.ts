import { defineConfig } from 'vite';
import * as path from 'path';
import fs from 'fs';
import { nlsPlugin } from './scripts/vite-plugin-nls';

export default defineConfig({
  clearScreen: false,
  assetsInclude: ['**/*.wasm', '**/*.json', '**/*.tmLanguage.json'],
  publicDir: 'public',
  plugins: [
    nlsPlugin(),
    {
      name: 'html-transform',
      transformIndexHtml: () => [
        {
          tag: 'script',
          attrs: {
            id: 'vscode-workbench-builtin-extensions',
          },
          children: JSON.stringify(generateExtensionDescriptors()),
        },
      ],
    },
  ],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      vs: path.resolve(__dirname, 'src/vs'),
    },
  },
  build: {
    target: ['es2022', 'chrome100'],
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 25000,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        textMateWorker: path.resolve(
          __dirname,
          'src/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.ts',
        ),
        editorWorker: path.resolve(__dirname, 'src/vs/editor/common/services/editorWebWorkerMain.ts'),
        extensionHostWorker: path.resolve(__dirname, 'src/vs/workbench/api/worker/extensionHostWorkerMain.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'editorWorker') {
            return 'assets/editorWorker.js';
          }
          if (chunkInfo.name === 'textMateWorker') {
            return 'assets/textMateWorker.js';
          }
          if (chunkInfo.name === 'extensionHostWorker') {
            return 'assets/extensionHostWorker.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if ((assetInfo.name ?? '').endsWith('.ts')) {
            const base = (assetInfo.name ?? 'asset').slice(0, -3);
            return `assets/${base}-[hash].js`;
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  optimizeDeps: {
    include: ['vscode-textmate', 'vscode-oniguruma'],
    exclude: ['@tauri-apps/api'],
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'workers/[name]-[hash].js',
        chunkFileNames: 'workers/[name]-[hash].js',
      },
    },
  },
});

// Escape HTML special characters
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Extensions directory
const extensionsDir = path.join(import.meta.dirname, 'extensions');

// Generate extension descriptors (same logic as generate-extension-meta.js)
function generateExtensionDescriptors(): { extensionPath: string; packageJSON: any; packageNLS?: any }[] {
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }

  const entries = fs.readdirSync(extensionsDir);
  const descriptors = [];

  for (const dirName of entries) {
    const dirPath = path.join(extensionsDir, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const pkgPath = path.join(dirPath, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;

    let packageJSON;
    try {
      packageJSON = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (err) {
      console.warn(`Skipping ${dirName}: failed to parse package.json`);
      continue;
    }

    let packageNLS = undefined;
    const nlsPath = path.join(dirPath, 'package.nls.json');
    if (fs.existsSync(nlsPath)) {
      try {
        packageNLS = JSON.parse(fs.readFileSync(nlsPath, 'utf-8'));
      } catch {
        // nls is optional
      }
    }

    const descriptor: any = { extensionPath: dirName, packageJSON };
    if (packageNLS) descriptor.packageNLS = packageNLS;
    descriptors.push(descriptor);
  }

  descriptors.sort((a, b) => a.extensionPath.localeCompare(b.extensionPath));
  return descriptors;
}
