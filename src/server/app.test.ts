import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { absolutizeMeta, createAppServer, injectMeta, type AppServerHandle } from './app';

let server: AppServerHandle;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'flock-client-'));
  writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><meta charset="UTF-8" /><title>Flock Poker</title><meta property="og:title" content="old" /><meta property="og:image" content="/og-image.png" /><meta name="twitter:image" content="/og-image.png" /></head><body><div id="root"></div></body></html>',
  );
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'app-123.js'), 'console.log(1)');
  server = createAppServer({ clientDir: dir });
  const port = await server.listen(0);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('http', () => {
  it('health', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('room summary (case-insensitive) and 404s', async () => {
    const room = server.rooms.create({ smallBlind: 25, bigBlind: 50, buyIn: 5000, maxPlayers: 6 });
    room.addHost('Alice');
    const res = await fetch(`${base}/api/rooms/${room.id.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      roomId: room.id,
      hostName: 'Alice',
      seated: 1,
      maxPlayers: 6,
      smallBlind: 25,
      bigBlind: 50,
      buyIn: 5000,
      status: 'lobby',
      started: false,
    });
    const missing = await fetch(`${base}/api/rooms/ZZZZZZ`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Room not found' });
    const bad = await fetch(`${base}/api/rooms/%3Cscript%3E`);
    expect(bad.status).toBe(404);
    const unknown = await fetch(`${base}/api/nope`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'Not found' });
  });

  it('serves the SPA with room-specific link previews on /g/:roomId', async () => {
    const room = server.rooms.create({ smallBlind: 1000, bigBlind: 2000, buyIn: 200_000, maxPlayers: 8 });
    room.addHost('Bo<b> "B"');
    const res = await fetch(`${base}/g/${room.id.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('<title>Join Bo&lt;b&gt; &quot;B&quot;&#39;s poker game</title>');
    expect(html).toContain('<meta property="og:title" content="Join Bo&lt;b&gt; &quot;B&quot;&#39;s poker game" />');
    expect(html).not.toContain('content="old"');
    expect(html).toContain(
      '<meta property="og:description" content="1,000/2,000 No-Limit Hold&#39;em · 1/8 seats · Tap to grab a seat" />',
    );
    expect(html).toContain('<meta name="twitter:title"');
    expect(html).toContain('<meta name="twitter:description"');
    expect(html).toContain('<div id="root"></div>');
    expect(html.match(/<title>/g)).toHaveLength(1);

    const unknownRoom = await (await fetch(`${base}/g/ZZZZZZ`)).text();
    expect(unknownRoom).toContain('<title>Flock Poker</title>');
  });

  it('SPA fallback for client routes, static assets with long cache', async () => {
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('<div id="root"></div>');
    const deep = await fetch(`${base}/some/client/route`);
    expect(await deep.text()).toContain('<div id="root"></div>');
    const asset = await fetch(`${base}/assets/app-123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(await asset.text()).toBe('console.log(1)');
    const missing = await fetch(`${base}/assets/gone-456.js`);
    expect(missing.status).toBe(404);
  });

  it('link previews use absolute image and page URLs', async () => {
    const room = server.rooms.create({});
    room.addHost('Alice');
    const html = await (await fetch(`${base}/g/${room.id}`)).text();
    expect(html).toContain(`<meta property="og:image" content="${base}/og-image.png" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${base}/og-image.png" />`);
    expect(html).toContain(`<meta property="og:url" content="${base}/g/${room.id}" />`);
    const home = await (await fetch(`${base}/`)).text();
    expect(home).toContain(`<meta property="og:image" content="${base}/og-image.png" />`);
    // a forged Host header never makes it into the page
    const forged = await (await fetch(`${base}/`, { headers: { host: 'evil.example"><script>' } }).catch(() => null))?.text();
    if (forged) expect(forged).not.toContain('<script>');
  });

  it('absolutizeMeta honours a configured public URL', () => {
    const out = absolutizeMeta('<head><meta property="og:image" content="/x.png" /></head>', 'https://poker.example.com/', '/g/ABC');
    expect(out).toContain('content="https://poker.example.com/x.png"');
    expect(out).toContain('<meta property="og:url" content="https://poker.example.com/g/ABC" />');
  });

  it('injectMeta inserts tags when absent', () => {
    const out = injectMeta('<html><head></head><body></body></html>', { title: 'T & co', description: 'D' });
    expect(out).toContain('<title>T &amp; co</title>');
    expect(out).toContain('<meta property="og:description" content="D" />');
    expect(out).toContain('<meta name="twitter:card" content="summary" />');
    expect(out.indexOf('<title>')).toBeLessThan(out.indexOf('</head>'));
  });

  it('$ patterns in user text stay literal (no page fragments spliced into the meta tags)', async () => {
    const page =
      '<!doctype html><html><head><title>Flock Poker</title><meta property="og:title" content="old" /><meta property="og:url" content="/" /></head><body></body></html>';
    const out = injectMeta(page, { title: "Join $`$&$$Bill$'s", description: "$` and $' and $&" });
    expect(out).toContain("<title>Join $`$&amp;$$Bill$&#39;s</title>");
    expect(out).toContain(`<meta property="og:title" content="Join $\`$&amp;$$Bill$&#39;s" />`);
    expect(out).toContain(`<meta name="twitter:description" content="$\` and $&#39; and $&amp;" />`);
    expect(out.match(/<!doctype/g)).toHaveLength(1);
    expect(out.match(/<title>/g)).toHaveLength(1);
    const abs = absolutizeMeta(page, 'https://poker.example.com', '/x$&y$`');
    expect(abs).toContain('<meta property="og:url" content="https://poker.example.com/x$&amp;y$`" />');
    expect(abs.match(/<\/head>/g)).toHaveLength(1);
    const noUrl = absolutizeMeta('<head></head>', 'https://p.example', "/a$'b");
    expect(noUrl).toBe(`<head>    <meta property="og:url" content="https://p.example/a$&#39;b" />\n  </head>`);

    // over HTTP: a host named "$`" gets a clean invite page
    const room = server.rooms.create({});
    room.addHost('$`');
    const html = await (await fetch(`${base}/g/${room.id}`)).text();
    expect(html).toContain('<title>Join $`&#39;s poker game</title>');
    expect(html).toContain('<meta property="og:title" content="Join $`&#39;s poker game" />');
    expect(html.match(/<!doctype/gi)).toHaveLength(1);
    const spa = await (await fetch(`${base}/x$&y`)).text();
    expect(spa).toContain(`<meta property="og:url" content="${base}/x$&amp;y" />`);
    expect(spa.match(/<\/head>/g)).toHaveLength(1);
  });

  it('works without a client dir', async () => {
    const s = createAppServer({ clientDir: null });
    const port = await s.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    await s.close();
  });
});
