/**
 * Record the demo page (demo.html) into an animated GIF for the README.
 * Uses the locally installed Chrome via puppeteer-core + gifenc + pngjs.
 *
 *   npm run demo:record
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
const W = 880, H = 495;
const SOLVED_DWELL_MS = 2600; // stop this long after "✓" appears
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

/** Box-downscale a PNG instance by an integer factor (smooths edges). */
function downscale(png, f) {
  const w = png.width / f, h = png.height / f;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * png.width + (x * f + dx)) * 4;
          r += png.data[i]; g += png.data[i + 1];
          b += png.data[i + 2]; a += png.data[i + 3];
        }
      }
      const o = (y * w + x) * 4, n = f * f;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

try {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", `--window-size=${W},${H}`],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/demo.html`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 800)); // let orientation settle

  // capture until the solved "✓" has been visible for SOLVED_DWELL_MS;
  // frame delays use real timestamps so the GIF plays at true speed
  // regardless of how slow each screenshot is
  const shots = [];
  const t0 = Date.now();
  let last = t0;
  let solvedSince = null;
  for (let i = 0; i < 600; i++) {
    const png = PNG.sync.read(await page.screenshot({ type: "png" }));
    const now = Date.now();
    shots.push({ png, delay: Math.max(30, now - last) });
    last = now;
    process.stdout.write(`\rframe ${i + 1} @ ${((now - t0) / 1000).toFixed(1)}s`);

    const txt = await page.$eval("#next-move", (el) => el.textContent.trim());
    if (txt === "✓") solvedSince ??= now;
    else solvedSince = null;
    if (solvedSince && now - solvedSince > SOLVED_DWELL_MS) break;
  }
  await browser.close();

  // one shared palette for the whole clip -> no per-frame color flicker
  const sampleEvery = 4;
  const parts = [];
  for (let i = 0; i < shots.length; i += sampleEvery) parts.push(shots[i].png.data);
  const palette = quantize(Buffer.concat(parts), 256);

  const gif = GIFEncoder();
  for (const { png, delay } of shots) {
    const small = downscale(png, 2);
    const idx = applyPalette(small.data, palette);
    gif.writeFrame(idx, small.width, small.height, { palette, delay });
  }
  gif.finish();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, gif.bytes());
  console.log(`\nwrote ${OUT}`);
} finally {
  vite.kill();
}
