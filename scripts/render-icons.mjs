// Renders the PNG icons + link preview image from public/icon.svg with the pre-installed Chromium.
// Usage: node scripts/render-icons.mjs   (writes into public/)
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const svg = await readFile(`${pub}icon.svg`, 'utf8');
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const BG = 'linear-gradient(135deg, #6d43ea 0%, #8a3ffc 55%, #ff5fa2 100%)';

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function shot(html, width, height, file) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box} html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
  </style></head><body>${html}</body></html>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${pub}${file}`, omitBackground: true });
  console.log('wrote', file);
}

// rounded icons for browsers / Android "any"
for (const size of [192, 512]) {
  await shot(`<img src="${svgUrl}" width="${size}" height="${size}" style="display:block">`, size, size, `icon-${size}.png`);
}
// full-bleed square versions (iOS and maskable icons get their corners cut by the OS)
const square = (size, scale) =>
  `<div style="width:${size}px;height:${size}px;background:${BG};display:grid;place-items:center">
     <img src="${svgUrl}" width="${Math.round(size * scale)}" height="${Math.round(size * scale)}" style="display:block">
   </div>`;
await shot(square(180, 1.12), 180, 180, 'apple-touch-icon.png');
await shot(square(512, 0.86), 512, 512, 'icon-maskable-512.png');

// 1200x630 link preview
const card = (rank, suit, color, rot) => `
  <div style="width:92px;height:128px;border-radius:14px;background:linear-gradient(#fff,#f2eeff);
    box-shadow:0 5px 0 rgba(36,26,74,.3),0 14px 24px rgba(0,0,0,.25);position:relative;transform:rotate(${rot}deg);
    font-family:Inter,system-ui,sans-serif;color:${color};font-weight:900">
    <span style="position:absolute;left:10px;top:4px;font-size:48px;letter-spacing:-2px">${rank}</span>
    <span style="position:absolute;right:8px;bottom:0;font-size:60px">${suit}</span>
  </div>`;
await shot(
  `<div style="width:1200px;height:630px;background:
      radial-gradient(rgba(255,255,255,.09) 3px, transparent 3.5px) 0 0/34px 34px, ${BG};
      display:flex;align-items:center;gap:40px;padding:0 70px;font-family:Inter,system-ui,sans-serif;color:#fff">
    <div style="flex:none;position:relative;width:440px;height:440px;display:grid;place-items:center">
      <img src="${svgUrl}" width="440" height="440" style="display:block;filter:drop-shadow(0 18px 30px rgba(30,0,80,.45))">
    </div>
    <div style="display:flex;flex-direction:column;gap:22px">
      <div style="font-size:104px;font-weight:900;line-height:.92;letter-spacing:-3px;text-shadow:0 7px 0 rgba(40,10,110,.35)">
        Flock <span style="color:#ffc83d;display:inline-block;transform:rotate(-3deg)">Poker</span>
      </div>
      <div style="font-size:40px;font-weight:800;line-height:1.15">No-Limit Hold’em<br>for the group chat</div>
      <div style="display:flex;gap:14px;margin-top:6px">
        ${card('A', '♠', '#231d3a', -8)}${card('K', '♥', '#e5304c', 6)}
      </div>
      <div style="display:flex;gap:12px;font-size:21px;font-weight:800;white-space:nowrap">
        <span style="background:rgba(255,255,255,.2);padding:10px 18px;border-radius:999px">One buy-in each</span>
        <span style="background:rgba(255,255,255,.2);padding:10px 18px;border-radius:999px">Buy back only if everyone agrees</span>
      </div>
    </div>
  </div>`,
  1200,
  630,
  'og-image.png',
);

await browser.close();
