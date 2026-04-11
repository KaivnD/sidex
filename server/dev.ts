/**
 * SideX Dev Server
 * - Starts Vite dev server as child process
 * - Starts SideX file system server
 * - Provides unified proxy (Vite + SideX on single port)
 *
 * Usage: bun scripts/dev.ts
 *        PORT=3000 VITE_PORT=1420 SIDEX_PORT=5945 bun scripts/dev.ts
 */

import { spawn } from 'child_process';
import { createSideXServer } from '../server/index';

const PORT = parseInt(process.env.PORT || '3000');
const VITE_PORT = parseInt(process.env.VITE_PORT || '1420');
const SIDEX_PORT = parseInt(process.env.SIDEX_PORT || '5946');
const HOST = process.env.HOST || 'localhost';

let viteProcess: ReturnType<typeof spawn> | null = null;
let sideXServer: ReturnType<typeof createSideXServer> | null = null;

// Start Vite dev server
function startVite(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[Dev] Starting Vite on port ${VITE_PORT}...`);

    viteProcess = spawn('bun', ['run', 'dev'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(VITE_PORT) },
    });

    viteProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(`[Vite] ${output}`);
      if (output.includes('Local:') || output.includes('ready in')) {
        console.log(`[Dev] Vite ready at http://${HOST}:${VITE_PORT}`);
        resolve();
      }
    });

    viteProcess.stderr?.on('data', (data) => {
      process.stderr.write(`[Vite] ${data}`);
    });

    viteProcess.on('error', reject);
    setTimeout(() => resolve(), 5000);
  });
}

// Start SideX server
function startSideX(): ReturnType<typeof createSideXServer> {
  console.log(`[Dev] Starting SideX server on port ${SIDEX_PORT}...`);
  const server = createSideXServer(SIDEX_PORT, HOST);
  console.log(`[Dev] SideX server ready at ws://${HOST}:${SIDEX_PORT}?workspaceId=<id>`);
  return server;
}

// Proxy request to SideX server (for extensions and other SideX HTTP endpoints)
async function proxyToSideX(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = `http://${HOST}:${SIDEX_PORT}${url.pathname}${url.search}`;

  try {
    const res = await fetch(target, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (err) {
    return new Response(`SideX error: ${err}`, { status: 502 });
  }
}

// Proxy request to Vite with HTML injection for extension meta
async function proxyToVite(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = `http://${HOST}:${VITE_PORT}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  headers.delete('host');

  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: req.body,
    });

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (err) {
    return new Response(`Vite error: ${err}`, { status: 502 });
  }
}

// Start unified proxy server
function startProxy(): ReturnType<typeof Bun.serve> {
  console.log(`[Dev] Starting unified proxy on port ${PORT}...`);

  const proxy = Bun.serve<{ type: 'vite' | 'sidex'; url?: string }>({
    port: PORT,
    hostname: HOST,

    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname.startsWith('/extensions')) {
        return proxyToSideX(req);
      }

      // Debug logging
      // console.log(`[Dev] WS request: pathname='${url.pathname}', search='${url.search}', hasWorkspaceId=${url.searchParams.has('workspaceId')}, hasToken=${url.searchParams.has('token')}`);

      // Vite HMR WebSocket (token param or /@vite/ path)
      if (url.searchParams.has('token') || url.pathname.startsWith('/@vite/') || url.pathname === '/__vite_hmr__') {
        if (server.upgrade(req, { data: { type: 'vite', search: url.search } })) {
          return;
        }
      }

      // SideX WebSocket - match any path with workspaceId
      if (url.searchParams.has('workspaceId')) {
        console.log(`[Dev] Upgrading SideX WebSocket: ${url.pathname}${url.search}`);
        if (server.upgrade(req, { data: { type: 'sidex', path: url.pathname || '/', search: url.search } })) {
          return;
        }
      }

      // Everything else -> Vite
      return proxyToVite(req);
    },

    websocket: {
      open(ws) {
        if (ws.data.type === 'vite') {
          // Proxy Vite HMR WebSocket
          const viteWs = new WebSocket(`ws://${HOST}:${VITE_PORT}/@vite/ws${ws.data.search || ''}`);
          (ws as any).targetWs = viteWs;

          viteWs.onopen = () => console.log('[Dev] Vite HMR connected');
          viteWs.onmessage = (e) => ws.send(e.data);
          viteWs.onclose = () => ws.close();
          viteWs.onerror = () => ws.close();
        } else if (ws.data.type === 'sidex') {
          // Proxy SideX WebSocket
          const sideXWs = new WebSocket(`ws://${HOST}:${SIDEX_PORT}${ws.data.path}${ws.data.search}`);
          (ws as any).targetWs = sideXWs;
          (ws as any).messageQueue = [];

          sideXWs.onopen = () => {
            console.log('[Dev] SideX proxy connected');
            // Flush queued messages
            const queue = (ws as any).messageQueue as any[];
            for (const msg of queue) {
              sideXWs.send(msg);
            }
            (ws as any).messageQueue = [];
          };
          sideXWs.onmessage = (e) => ws.send(e.data);
          sideXWs.onclose = () => ws.close();
          sideXWs.onerror = (err) => {
            console.error('[Dev] SideX proxy error:', err);
            ws.close();
          };
        }
      },

      message(ws, message) {
        const target = (ws as any).targetWs as WebSocket;
        if (target?.readyState === WebSocket.OPEN) {
          target.send(message);
        } else if (target?.readyState === WebSocket.CONNECTING) {
          // Queue messages until connected
          ((ws as any).messageQueue ||= []).push(message);
        }
      },

      close(ws) {
        const target = (ws as any).targetWs;
        if (target?.readyState === WebSocket.OPEN) {
          target.close();
        }
      },

      perMessageDeflate: false,
    },

    error(error) {
      console.error('[Dev] Proxy error:', error);
      return new Response('Proxy Error', { status: 500 });
    },
  });

  console.log(`[Dev] ==========================================`);
  console.log(`[Dev] Unified server running at http://${HOST}:${PORT}`);
  console.log(`[Dev] -> Vite dev server (with HMR) from :${VITE_PORT}`);
  console.log(`[Dev] -> SideX FS WebSocket at ws://${HOST}:${PORT}?workspaceId=<id>`);
  console.log(`[Dev] ==========================================`);

  return proxy;
}

// Main
async function main() {
  await startVite();
  sideXServer = startSideX();
  const proxy = startProxy();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Dev] Shutting down...');
    viteProcess?.kill('SIGINT');
    sideXServer?.stop();
    proxy.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Dev] Failed to start:', err);
  process.exit(1);
});
