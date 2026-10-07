import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { logger } from '../logger.js';
import { checkAdminHttp } from './adminGuard.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const PUBLIC_DIR = resolve(process.cwd(), 'public');
// Phaser servido localmente (node_modules) em vez de CDN: a live roda 24/7 e
// não pode depender da disponibilidade de um CDN externo pro client renderizar.
const PHASER_PATH = join(process.cwd(), 'node_modules', 'phaser', 'dist', 'phaser.min.js');
const MAX_BODY_BYTES = 16 * 1024;

export interface AdminHttpResult {
  status: number;
  body: unknown;
}

export interface AdminHttpHandlers {
  getStatus: () => unknown;
  runCommand: (body: unknown) => AdminHttpResult | Promise<AdminHttpResult>;
}

export interface StaticServerOptions {
  getLeaderboard?: () => unknown;
  getHealth?: () => unknown;
  admin?: AdminHttpHandlers;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body grande demais'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf-8') || 'null'));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function handleAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  admin: AdminHttpHandlers,
): Promise<void> {
  if (pathname === '/api/admin/status' && req.method === 'GET') {
    sendJson(res, 200, admin.getStatus());
    return;
  }

  if (pathname === '/api/admin/command' && req.method === 'POST') {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: (err as Error).message });
      return;
    }
    const result = await admin.runCommand(body);
    sendJson(res, result.status, result.body);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'rota admin inexistente' });
}

async function serveFile(res: ServerResponse, filePath: string): Promise<void> {
  const data = await readFile(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    // localhost + arte/código trocados a quente durante o desenvolvimento:
    // sem cache evita OBS/navegador mostrar versão velha.
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

export function startStaticServer(port: number, options: StaticServerOptions = {}): void {
  const server = createServer(async (req, res) => {
    try {
      // req.url inclui querystring (ex: "/?transparent=1") — só o pathname
      // importa pra roteamento/arquivo, senão "/?transparent=1" não bate com
      // "/" e cai no 404 (bug real: era assim que o OBS usava a URL).
      const pathname = new URL(req.url ?? '/', 'http://internal').pathname;

      const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/');
      if (isAdminPath) {
        if (!options.admin) {
          sendJson(res, 404, { ok: false, error: 'admin desabilitado' });
          return;
        }
        const guard = checkAdminHttp({
          remoteAddress: req.socket.remoteAddress,
          host: header(req, 'host'),
          origin: header(req, 'origin'),
          method: req.method ?? 'GET',
          contentType: header(req, 'content-type'),
          adminHeader: header(req, 'x-admin'),
        });
        if (!guard.ok) {
          logger.warn({ reason: guard.reason, remote: req.socket.remoteAddress, pathname }, 'requisição admin recusada');
          sendJson(res, 403, { ok: false, error: guard.reason });
          return;
        }
        if (pathname.startsWith('/api/admin/')) {
          await handleAdminApi(req, res, pathname, options.admin);
          return;
        }
        if (pathname === '/admin') {
          res.writeHead(301, { Location: '/admin/' });
          res.end();
          return;
        }
      }

      if (pathname === '/vendor/phaser.min.js') {
        const data = await readFile(PHASER_PATH);
        res.writeHead(200, { 'Content-Type': MIME['.js'] });
        res.end(data);
        return;
      }

      if (pathname === '/api/leaderboard' && options.getLeaderboard) {
        sendJson(res, 200, options.getLeaderboard());
        return;
      }

      if (pathname === '/health' && options.getHealth) {
        const health = options.getHealth() as { ok: boolean };
        sendJson(res, health.ok ? 200 : 503, health);
        return;
      }

      let urlPath = pathname;
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const filePath = resolve(PUBLIC_DIR, `.${urlPath}`);
      // nunca servir nada fora de public/ (path traversal)
      if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      await serveFile(res, filePath);
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(port, () => logger.info({ port }, 'client HTTP server pronto (pra OBS Browser Source)'));
}
