/**
 * Record the demo page (demo.html) into an animated GIF for the README.
 * Uses the locally installed Chrome via puppeteer-core + gifenc + pngjs.
 *
 *   npm run build && node scripts/record-demo.mjs
 *
 * Output: assets/demo.gif
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import gifencPkg from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifencPkg;

const PORT = 5199;
const FRAMES = 70;
const INTERVAL_MS = 90;
const W = 640, H = 480;
const OUT = fileURLToPath(new URL("../assets/demo.gif", import.meta.url));

const vite = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
});
for (let i = 0; i < 40; i++) { // wait for preview server
  try {
    const r = await fetch(`http://localhost:${PORT}/demo.html`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

try {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", `--window-size=${W},${H}`],
    defaultViewport: { width: W, height: H },
  });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/demo.html`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1500)); // let orientation settle

  const gif = GIFEncoder();
  for (let i = 0; i < FRAMES; i++) {
    const shot = await page.screenshot({ type: "png" });
    const png = PNG.sync.read(shot);
    const palette = quantize(png.data, 256);
    const idx = applyPalette(png.data, palette);
    gif.writeFrame(idx, png.width, png.height, { palette, delay: INTERVAL_MS });
    process.stdout.write(`\rframe ${i + 1}/${FRAMES}`);
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  gif.finish();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, gif.bytes());
  console.log(`\nwrote ${OUT}`);
  await browser.close();
} finally {
  vite.kill();
}
