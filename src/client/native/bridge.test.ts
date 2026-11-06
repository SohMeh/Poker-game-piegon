import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeInfo, NativeToWeb, WebToNative } from './bridgeTypes';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../ios/FlockKit/Tests/FlockKitTests/Fixtures/bridge-events.json',
);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  nativeInfo: NativeInfo;
  webToNative: WebToNative[];
  nativeToWeb: NativeToWeb[];
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

interface FakeWindowOpts {
  search?: string;
  info?: unknown;
  handler?: { postMessage: (m: unknown) => void } | null;
}

/** A window-like EventTarget with the pieces the bridge reads. */
function fakeWindow(o: FakeWindowOpts = {}) {
  const w = new EventTarget() as EventTarget & Record<string, unknown>;
  w.location = { search: o.search ?? '' };
  if (o.info !== undefined) w.__FLOCK_NATIVE__ = o.info;
  if (o.handler) w.webkit = { messageHandlers: { flock: o.handler } };
  vi.stubGlobal('window', w);
  return w;
}

function recorder() {
  const posted: unknown[] = [];
  return { posted, handler: { postMessage: (m: unknown) => void posted.push(m) } };
}

const load = () => import('./bridge');

describe('isEmbedded', () => {
  it('is false without a window, in a plain browser, or with only half of the native injection', async () => {
    let b = await load();
    expect(b.isEmbedded()).toBe(false); // vitest runs in node: no window at all
    vi.resetModules();
    fakeWindow();
    b = await load();
    expect(b.isEmbedded()).toBe(false);
    vi.resetModules();
    fakeWindow({ handler: recorder().handler });
    b = await load();
    expect(b.isEmbedded()).toBe(false);
    vi.resetModules();
    fakeWindow({ info: fixture.nativeInfo });
    b = await load();
    expect(b.isEmbedded()).toBe(false);
    vi.resetModules();
    fakeWindow({ info: { ...fixture.nativeInfo, platform: 'android' }, handler: recorder().handler });
    b = await load();
    expect(b.isEmbedded()).toBe(false);
  });

  it('is true with the injected info and the flock handler', async () => {
    fakeWindow({ info: fixture.nativeInfo, handler: recorder().handler });
    const b = await load();
    expect(b.isEmbedded()).toBe(true);
    expect(b.canPostNative()).toBe(true);
  });

  it('honours ?embed=imessage before the injection, and stays embedded for the page session', async () => {
    const w = fakeWindow({ search: '?embed=imessage&create=1' });
    const b = await load();
    expect(b.isEmbedded()).toBe(true);
    expect(b.canPostNative()).toBe(false); // nothing to post to yet
    w.location = { search: '' };
    expect(b.isEmbedded()).toBe(true);
  });
});

describe('nativeInfo', () => {
  it('reads the fixture injection', async () => {
    fakeWindow({ info: fixture.nativeInfo });
    const b = await load();
    expect(b.nativeInfo()).toEqual(fixture.nativeInfo);
  });

  it('normalises odd values and rejects other platforms', async () => {
    fakeWindow({ info: { platform: 'imessage', version: '2', name: '   ', presentation: 'weird' } });
    let b = await load();
    expect(b.nativeInfo()).toEqual({ platform: 'imessage', version: 0, name: null, presentation: 'expanded' });
    vi.resetModules();
    fakeWindow({ info: { platform: 'imessage', version: 1, name: ' Sam ', presentation: 'compact' } });
    b = await load();
    expect(b.nativeInfo()).toEqual({ platform: 'imessage', version: 1, name: 'Sam', presentation: 'compact' });
    vi.resetModules();
    fakeWindow({ info: 'imessage' });
    b = await load();
    expect(b.nativeInfo()).toBeNull();
  });
});

describe('postNative', () => {
  it('is a no-op outside the app (no window, plain browser, embed flag without a handler)', async () => {
    let b = await load();
    expect(b.postNative({ type: 'haptic', style: 'light' })).toBe(false);
    vi.resetModules();
    fakeWindow();
    b = await load();
    expect(b.postNative({ type: 'haptic', style: 'light' })).toBe(false);
    vi.resetModules();
    fakeWindow({ search: '?embed=imessage' });
    b = await load();
    expect(b.postNative({ type: 'haptic', style: 'light' })).toBe(false);
  });

  it('does not post to a stray handler when the page is not embedded', async () => {
    const r = recorder();
    fakeWindow({ handler: r.handler });
    const b = await load();
    expect(b.postNative({ type: 'rememberName', name: 'Sam' })).toBe(false);
    expect(r.posted).toEqual([]);
  });

  it('hands every fixture event to native as plain JSON', async () => {
    const r = recorder();
    fakeWindow({ info: fixture.nativeInfo, handler: r.handler });
    const b = await load();
    for (const e of fixture.webToNative) expect(b.postNative(e)).toBe(true);
    expect(r.posted).toEqual(fixture.webToNative);
    // undefined fields are dropped, prototypes flattened
    b.postNative({ type: 'rememberName', name: 'Sam', extra: undefined } as unknown as WebToNative);
    expect(r.posted.at(-1)).toEqual({ type: 'rememberName', name: 'Sam' });
    expect(Object.keys(r.posted.at(-1) as object)).toEqual(['type', 'name']);
  });

  it('posts once the handler appears (flag first, injection later)', async () => {
    const w = fakeWindow({ search: '?embed=imessage' });
    const b = await load();
    expect(b.postNative({ type: 'haptic', style: 'light' })).toBe(false);
    const r = recorder();
    w.webkit = { messageHandlers: { flock: r.handler } };
    expect(b.postNative({ type: 'haptic', style: 'light' })).toBe(true);
    expect(r.posted).toEqual([{ type: 'haptic', style: 'light' }]);
  });

  it('never throws, even when native throws', async () => {
    fakeWindow({
      info: fixture.nativeInfo,
      handler: {
        postMessage: () => {
          throw new Error('boom');
        },
      },
    });
    const b = await load();
    expect(() => b.postNative({ type: 'haptic', style: 'light' })).not.toThrow();
    expect(b.postNative({ type: 'haptic', style: 'light' })).toBe(false);
  });
});

describe('onNative', () => {
  it('delivers every fixture message (object or JSON text) and ignores junk', async () => {
    const w = fakeWindow({ info: fixture.nativeInfo, handler: recorder().handler });
    const b = await load();
    const got: NativeToWeb[] = [];
    const off = b.onNative((m) => got.push(m));
    for (const m of fixture.nativeToWeb) w.dispatchEvent(new CustomEvent(b.NATIVE_EVENT, { detail: m }));
    w.dispatchEvent(new CustomEvent(b.NATIVE_EVENT, { detail: JSON.stringify(fixture.nativeToWeb[0]) }));
    for (const junk of [null, 'nope', 42, { type: 'presentation', style: 'huge' }, { type: 'bubbleResult', ok: 'yes' }, { type: 'other' }]) {
      w.dispatchEvent(new CustomEvent(b.NATIVE_EVENT, { detail: junk }));
    }
    expect(got).toEqual([...fixture.nativeToWeb, fixture.nativeToWeb[0]]);
    off();
    w.dispatchEvent(new CustomEvent(b.NATIVE_EVENT, { detail: fixture.nativeToWeb[0] }));
    expect(got).toHaveLength(fixture.nativeToWeb.length + 1);
  });

  it('a throwing listener does not break dispatch; no window means a no-op', async () => {
    const w = fakeWindow();
    let b = await load();
    b.onNative(() => {
      throw new Error('listener bug');
    });
    expect(() => w.dispatchEvent(new CustomEvent(b.NATIVE_EVENT, { detail: fixture.nativeToWeb[0] }))).not.toThrow();
    vi.unstubAllGlobals();
    vi.resetModules();
    b = await load();
    expect(() => b.onNative(() => undefined)()).not.toThrow();
  });

  it('parseNativeMessage keeps exactly the contract fields', async () => {
    const b = await load();
    expect(b.parseNativeMessage({ type: 'bubbleResult', dedupeKey: 'k', ok: true, sent: true, error: null, extra: 1 })).toEqual({
      type: 'bubbleResult',
      dedupeKey: 'k',
      ok: true,
      sent: true,
      error: null,
    });
    expect(b.parseNativeMessage({ type: 'presentation', style: 'compact', x: 1 })).toEqual({ type: 'presentation', style: 'compact' });
  });
});
