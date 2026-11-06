// Static checks on the stylesheets for older phone browsers.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sheets = readdirSync(dir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ file: f, css: readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));

/** Every `prop: value` declaration with the selector block it belongs to. */
function declarations(css: string): { selector: string; prop: string; value: string; block: string }[] {
  const out: { selector: string; prop: string; value: string; block: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const selector = m[1]!.trim();
    const block = m[2]!;
    for (const decl of block.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      out.push({ selector, prop: decl.slice(0, i).trim(), value: decl.slice(i + 1).trim(), block });
    }
  }
  return out;
}

describe('stylesheets', () => {
  it('color-mix() only appears in background-image, next to a solid background-color fallback', () => {
    // iOS Safari < 16.2 has no color-mix(): with var() inside, the whole declaration becomes
    // invalid at computed-value time, so it must never be the only source of a fill.
    let found = 0;
    for (const { file, css } of sheets) {
      for (const d of declarations(css)) {
        if (!d.value.includes('color-mix(')) continue;
        found++;
        expect(`${file} ${d.selector} ${d.prop}`).toBe(`${file} ${d.selector} background-image`);
        expect(d.block).toMatch(/(^|;)\s*background-color\s*:/);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
