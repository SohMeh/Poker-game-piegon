// Renders the iMessage app icons (and the small logo used by the compact Messages view) from
// public/icon.svg with the pre-installed Chromium, and writes them into the extension's asset catalog.
// Usage: node scripts/render-imessage-icons.mjs
//
// The artwork is drawn into a <canvas> at the exact pixel size of every slot, read back with
// getImageData and encoded here as PNG, so every file has exactly the size Xcode expects.
// App icons are written WITHOUT an alpha channel (the App Store rejects transparent app icons).
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = `${root}ios/FlockPokerMessages/Assets.xcassets/`;
const iconSetDir = `${catalog}iMessage App Icon.stickersiconset/`;
const logoSetDir = `${catalog}Logo.imageset/`;

const svg = await readFile(`${root}public/icon.svg`, 'utf8');
// The icon without its own rounded purple tile: the full-bleed icons paint the background themselves
// (Messages masks the corners), so the artwork sits on one continuous gradient at any aspect ratio.
const BG_RECT = '<rect width="512" height="512" rx="112" fill="url(#bg)"/>';
if (!svg.includes(BG_RECT)) throw new Error('public/icon.svg changed: background <rect> not found');
const artSvg = svg.replace(BG_RECT, '');
const dataUrl = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;

/**
 * The slots of an iMessage App Icon set (Xcode's "iMessage App Icon" template).
 * size is in points; pixels = size * scale.
 */
const SLOTS = [
  { idiom: 'iphone', size: [29, 29], scale: 2 }, // Settings
  { idiom: 'iphone', size: [29, 29], scale: 3 },
  { idiom: 'iphone', size: [60, 45], scale: 2 }, // Messages app drawer
  { idiom: 'iphone', size: [60, 45], scale: 3 },
  { idiom: 'ipad', size: [29, 29], scale: 2 },
  { idiom: 'ipad', size: [67, 50], scale: 2 },
  { idiom: 'ipad', size: [74, 55], scale: 2 },
  { idiom: 'ios-marketing', size: [1024, 1024], scale: 1 }, // App Store
  { idiom: 'universal', platform: 'ios', size: [27, 20], scale: 2 }, // Messages (small)
  { idiom: 'universal', platform: 'ios', size: [27, 20], scale: 3 },
  { idiom: 'universal', platform: 'ios', size: [32, 24], scale: 2 },
  { idiom: 'universal', platform: 'ios', size: [32, 24], scale: 3 },
  { idiom: 'ios-marketing', platform: 'ios', size: [1024, 768], scale: 1 }, // Messages App Store
];

const LOGO_POINTS = 64;

// ------------------------------------------------------------------ PNG encoding
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** rgba: Uint8Array of width*height*4. alpha=false writes an RGB (colour type 2) PNG. */
function encodePng(width, height, rgba, alpha) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
      if (alpha) raw[o++] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // colour type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ rendering
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');

/** Draws in the page and returns the RGBA pixels. */
async function render(width, height, mode) {
  const base64 = await page.evaluate(
    async ({ width, height, mode, art, full }) => {
      const load = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      if (mode === 'logo') {
        const img = await load(full);
        ctx.drawImage(img, 0, 0, width, height);
      } else {
        // Same gradient as the icon tile (#6d43ea -> #8a3ffc -> #ff5fa2, top-left to bottom-right).
        const g = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0, '#6d43ea');
        g.addColorStop(0.55, '#8a3ffc');
        g.addColorStop(1, '#ff5fa2');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        // Soft polka dots like the link preview card.
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        const step = Math.max(6, Math.round(Math.min(width, height) / 9));
        const r = Math.max(1, step * 0.09);
        for (let y = step / 2; y < height; y += step) {
          for (let x = step / 2; x < width; x += step) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // The 512x512 artwork (table + mascot), scaled to the height and centred. Square slots get a
        // slightly larger mascot; wide slots keep the whole table visible.
        const img = await load(art);
        const wide = width / height > 1.1;
        const s = (wide ? 1.06 : 1.08) * height;
        const x = (width - s) / 2;
        const y = (height - s) / 2 - (wide ? 0.04 : 0.03) * height;
        ctx.drawImage(img, x, y, s, s);
      }
      const data = ctx.getImageData(0, 0, width, height).data;
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { width, height, mode, art: dataUrl(artSvg), full: dataUrl(svg) },
  );
  const rgba = Buffer.from(base64, 'base64');
  if (rgba.length !== width * height * 4) throw new Error(`bad pixel buffer for ${width}x${height}`);
  return rgba;
}

await mkdir(iconSetDir, { recursive: true });
await mkdir(logoSetDir, { recursive: true });

const images = [];
for (const slot of SLOTS) {
  const [w, h] = slot.size;
  const pw = w * slot.scale;
  const ph = h * slot.scale;
  const filename = `icon-${slot.idiom}-${w}x${h}@${slot.scale}x.png`;
  const rgba = await render(pw, ph, 'icon');
  await writeFile(`${iconSetDir}${filename}`, encodePng(pw, ph, rgba, false));
  const entry = { filename, idiom: slot.idiom, scale: `${slot.scale}x`, size: `${w}x${h}` };
  if (slot.platform) entry.platform = slot.platform;
  images.push(entry);
  console.log(`wrote ${filename} (${pw}x${ph})`);
}
await writeFile(
  `${iconSetDir}Contents.json`,
  `${JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2)}\n`,
);

const logoImages = [];
for (const scale of [1, 2, 3]) {
  const px = LOGO_POINTS * scale;
  const filename = `logo@${scale}x.png`;
  const rgba = await render(px, px, 'logo');
  await writeFile(`${logoSetDir}${filename}`, encodePng(px, px, rgba, true));
  logoImages.push({ filename, idiom: 'universal', scale: `${scale}x` });
  console.log(`wrote ${filename} (${px}x${px})`);
}
await writeFile(
  `${logoSetDir}Contents.json`,
  `${JSON.stringify({ images: logoImages, info: { author: 'xcode', version: 1 } }, null, 2)}\n`,
);
await writeFile(`${catalog}Contents.json`, `${JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2)}\n`);

await browser.close();
