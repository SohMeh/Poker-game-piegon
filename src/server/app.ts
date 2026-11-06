// Express + Socket.IO server factory (used by index.ts and the tests).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import { formatChips, type Card } from '../shared';
import { normalizeRoomId } from './room/ids';
import type { Timing } from './room/Room';
import { RoomManager } from './room/RoomManager';
import { registerSocketHandlers, type AppServer, type SocketLimits, type SocketLayer } from './socket';

export interface AppServerOptions {
  /** Folder with the built client (index.html + assets). null = do not serve static files. */
  clientDir?: string | null;
  /** Pacing overrides (tests). */
  timing?: Partial<Timing>;
  socketLimits?: SocketLimits;
  /** Test hooks forwarded to every room. */
  deckFactory?: (handNumber: number) => Card[] | undefined;
  rand?: () => number;
  /**
   * Public origin (e.g. "https://poker.example.com") used for absolute link-preview URLs
   * (og:image, og:url). Defaults to the request's protocol + Host header.
   */
  publicUrl?: string | null;
}

export interface AppServerHandle {
  app: Express;
  httpServer: HttpServer;
  io: AppServer;
  rooms: RoomManager;
  sockets: SocketLayer;
  /** Starts listening; resolves with the actual port (useful with port 0). */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

/** dist/client next to the bundled dist/server/index.js; when running from src/ (tsx), the repo's dist/client. */
export function defaultClientDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (here.split(path.sep).slice(-2).join('/') === 'src/server') return path.resolve(here, '../../dist/client');
  return path.resolve(here, '../client');
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

const META_TAGS: { attr: 'property' | 'name'; key: string; field: 'title' | 'description' }[] = [
  { attr: 'property', key: 'og:title', field: 'title' },
  { attr: 'property', key: 'og:description', field: 'description' },
  { attr: 'name', key: 'twitter:title', field: 'title' },
  { attr: 'name', key: 'twitter:description', field: 'description' },
  { attr: 'name', key: 'description', field: 'description' },
];

/** Replaces (or inserts) <title>, og:*, twitter:* and description meta tags. Values are raw text. */
export function injectMeta(html: string, meta: { title: string; description: string }): string {
  const title = escapeHtml(meta.title);
  const desc = escapeHtml(meta.description);
  const inserts: string[] = [];
  let out = html;
  if (/<title>[\s\S]*?<\/title>/i.test(out)) out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  else inserts.push(`<title>${title}</title>`);
  for (const tag of META_TAGS) {
    const value = tag.field === 'title' ? title : desc;
    const re = new RegExp(`<meta\\s+[^>]*${tag.attr}=["']${tag.key.replace(':', '\\:')}["'][^>]*>`, 'i');
    const replacement = `<meta ${tag.attr}="${tag.key}" content="${value}" />`;
    if (re.test(out)) out = out.replace(re, replacement);
    else inserts.push(replacement);
  }
  if (!/<meta\s+[^>]*property=["']og:type["']/i.test(out)) inserts.push('<meta property="og:type" content="website" />');
  if (!/<meta\s+[^>]*name=["']twitter:card["']/i.test(out)) inserts.push('<meta name="twitter:card" content="summary" />');
  if (inserts.length) {
    const block = inserts.map((t) => `    ${t}\n`).join('');
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${block}  </head>`) : block + out;
  }
  return out;
}

/**
 * Link scrapers (iMessage, WhatsApp, Slack…) need absolute URLs: makes og:image / twitter:image
 * absolute and sets og:url for the page being served.
 */
export function absolutizeMeta(html: string, origin: string, pagePath: string): string {
  const base = origin.replace(/\/+$/, '');
  let out = html.replace(
    /(<meta\s+[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["'])(\/[^"']*)(["'][^>]*>)/gi,
    (_m, pre: string, url: string, post: string) => `${pre}${escapeHtml(base)}${url}${post}`,
  );
  const ogUrl = `<meta property="og:url" content="${escapeHtml(base + pagePath)}" />`;
  const re = /<meta\s+[^>]*property=["']og:url["'][^>]*>/i;
  if (re.test(out)) out = out.replace(re, ogUrl);
  else if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `    ${ogUrl}\n  </head>`);
  return out;
}

/** Only well-formed origins make it into the page (the Host header is client-controlled). */
function requestOrigin(req: Request, publicUrl: string | null | undefined): string | null {
  if (publicUrl) return publicUrl;
  const host = req.get('host') ?? '';
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  return `${req.protocol === 'https' ? 'https' : 'http'}://${host}`;
}

export function createAppServer(opts: AppServerOptions = {}): AppServerHandle {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  const httpServer = createServer(app);
  const io: AppServer = new Server(httpServer, {
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });
  const rooms = new RoomManager({ timing: opts.timing, deckFactory: opts.deckFactory, rand: opts.rand });
  const sockets = registerSocketHandlers(io, rooms, opts.socketLimits);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // ------------------------------------------------------------------ API
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/rooms/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    res.setHeader('Cache-Control', 'no-store');
    if (!room || room.disposed) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    res.json(room.summary());
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ------------------------------------------------------------------ client
  const clientDir = opts.clientDir === undefined ? defaultClientDir() : opts.clientDir;
  const indexPath = clientDir ? path.join(clientDir, 'index.html') : null;
  let cached: { mtimeMs: number; html: string } | null = null;
  const readIndex = (): string | null => {
    if (!indexPath) return null;
    try {
      const st = statSync(indexPath);
      if (!cached || cached.mtimeMs !== st.mtimeMs) cached = { mtimeMs: st.mtimeMs, html: readFileSync(indexPath, 'utf8') };
      return cached.html;
    } catch {
      return null;
    }
  };

  if (clientDir && existsSync(clientDir)) {
    app.use(
      express.static(clientDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
  }

  const sendIndex = (req: Request, res: Response, html: string) => {
    const origin = requestOrigin(req, opts.publicUrl);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(origin ? absolutizeMeta(html, origin, req.path) : html);
  };

  app.get('/g/:roomId', (req: Request, res: Response, next: NextFunction) => {
    const html = readIndex();
    if (!html) return next();
    const id = normalizeRoomId(req.params.roomId);
    const room = id ? rooms.get(id) : undefined;
    if (!room || room.disposed) return sendIndex(req, res, html);
    const s = room.summary();
    sendIndex(
      req,
      res,
      injectMeta(html, {
        title: `Join ${s.hostName}'s poker game`,
        description: `${formatChips(s.smallBlind)}/${formatChips(s.bigBlind)} No-Limit Hold'em · ${s.seated}/${s.maxPlayers} seats · Tap to grab a seat`,
      }),
    );
  });

  // SPA fallback for every other GET (not /api, not /socket.io)
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    // a missing asset (e.g. a stale /assets/*.js after a deploy) must 404, not return HTML
    if (/\.[a-z0-9]{1,8}$/i.test(req.path) && !req.path.endsWith('.html')) return next();
    const html = readIndex();
    if (!html) return next();
    sendIndex(req, res, html);
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).type('text').send('Not found');
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[http] error', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  });

  let closed = false;
  return {
    app,
    httpServer,
    io,
    rooms,
    sockets,
    listen(port: number, host?: string) {
      return new Promise<number>((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        httpServer.once('error', onError);
        httpServer.listen(port, host, () => {
          httpServer.off('error', onError);
          resolve((httpServer.address() as AddressInfo).port);
        });
      });
    },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      rooms.close();
      return new Promise<void>((resolve) => {
        // io.close() disconnects every socket and closes the http server
        void io.close(() => resolve());
        // drop lingering keep-alive HTTP connections so close() does not hang
        setImmediate(() => httpServer.closeAllConnections?.());
      });
    },
  };
}
