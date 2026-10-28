// Browser + capture: a slowed-down page clock and a retina screenshot loop.
// Measured on a 16 GB M-series Mac (2026-10-20): full 2880x1800 JPEG ≈ 35 fps, a small clip PNG ≈ 80–120 fps. Running
// the page at rate 0.2 turns that into 175–600 fps of page time, so every spring and pop is captured smoothly.
import { chromium } from "playwright-core";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// One virtual clock for performance.now, Date.now / new Date(), rAF timestamps and timer delays. CSS and WAAPI animations
// are slowed separately through CDP (Animation.setPlaybackRate), by the same factor.
const DILATE = `(() => {
  const rn = performance.now.bind(performance), rd = Date.now;
  let rate = 1, w0 = rn(), v0 = w0; const d0 = rd() - w0;
  const vnow = () => v0 + (rn() - w0) * rate;
  window.__setRate = r => { v0 = vnow(); w0 = rn(); rate = r; };
  window.__vnow = vnow;
  const RD = Date, now = () => Math.round(d0 + vnow());
  performance.now = vnow; RD.now = now;
  function D(...a) { return new.target ? (a.length ? new RD(...a) : new RD(now())) : new RD(now()).toString(); }
  D.prototype = RD.prototype; D.now = now; D.parse = RD.parse; D.UTC = RD.UTC;
  window.Date = D;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(() => cb(vnow()));
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (f, ms = 0, ...a) => st(f, ms / rate, ...a);
  window.setInterval = (f, ms = 0, ...a) => si(f, ms / rate, ...a);
})();`;

/** A PNG of the viewport (clip in CSS px) via CDP. Not page.screenshot: it waits for document.fonts.ready, which
 * waits for the load event, so it stalls on a page still fetching off-screen media. */
export async function snapshot(cdp, path, clip) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 } });
  writeFileSync(path, Buffer.from(r.data, "base64"));
}

/** Google Chrome: `chrome` (or $REC_CHROME) as an executable path, else the installed Chrome found by Playwright. */
export async function launch({ width = 1440, height = 900, dpr = 2, transparent = false, chrome = process.env.REC_CHROME } = {}) {
  const browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : { channel: "chrome" }), args: ["--disable-frame-rate-limit", "--disable-gpu-vsync", "--hide-scrollbars"] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.addInitScript(DILATE);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Animation.enable");
  if (transparent) await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  page.on("pageerror", (e) => console.warn("  pageerror:", e.message));
  return { browser, context, page, cdp, width, height, dpr };
}

export async function setRate(page, cdp, rate) {
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
  await page.evaluate((r) => window.__setRate(r), rate);
}

/** Always hidden in footage: the text caret. Apps add their own dev chrome via config `css`. */
export const CLEAN_CSS = `*{caret-color:transparent}`;

// Screenshots in flight at once. Chrome encodes them off its main thread, so two overlap: on bot18 at 2880x1800,
// 7-8 frames per real second became 14-16, never out of order, with the same stamp jitter (~10-20 ms). A third
// mostly returns repeats. Measured 2026-10-27.
const INFLIGHT = 2;

/** Real screenshots per second with the recorder's settings, over a few frames (no files written). Every shot counts,
 * repeats included: the page is still while this runs, and the question is how fast frames can be taken. */
export async function captureFps(cdp, { clip, scale, quality = 93, n = 8 }) {
  const shot = () => cdp.send("Page.captureScreenshot", { format: "jpeg", quality, optimizeForSpeed: true, clip: { ...clip, scale } });
  await shot(); // the first is slower
  const t0 = performance.now();
  await Promise.all(Array.from({ length: INFLIGHT }, async () => {
    for (let i = 0; i < n / INFLIGHT; i++) await shot();
  }));
  return (n * 1000) / (performance.now() - t0);
}

/**
 * Screenshot loop. Frames go to `dir` as they arrive; each is stamped with wall time. Call stop() to end.
 * clip is in CSS px (default: the whole viewport); scale is device px per CSS px. The explicit clip matters:
 * without it, headless Chrome returns 1× frames and system Chrome also crops ~87 px off the bottom.
 * alpha → PNG with a transparent background, otherwise JPEG.
 */
export function recorder(cdp, { dir, clip, scale, alpha = false, quality = 93 }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const writes = [];
  let running = true, failed = null; // a failed write (disk full) stops the loop; stop() reports it
  const t0 = performance.now();
  let last = null, shots = 0, lastWall = 0; // a repeat of the previous screenshot (nothing changed) is counted but not written
  const worker = async () => {
    while (running && !failed) {
      const t = performance.now();
      const r = await cdp.send("Page.captureScreenshot", {
        format: alpha ? "png" : "jpeg",
        ...(alpha ? {} : { quality }),
        optimizeForSpeed: true,
        clip: { ...clip, scale },
      });
      shots++;
      const wall = Math.max((t + performance.now()) / 2 - t0, lastWall + 0.01);
      lastWall = wall;
      if (r.data === last) continue;
      last = r.data;
      const file = join(dir, `f${String(frames.length).padStart(5, "0")}.${alpha ? "png" : "jpg"}`);
      const buf = Buffer.from(r.data, "base64");
      frames.push({ file, wall, bytes: buf.length });
      writes.push(writeFile(file, buf).catch((e) => { failed ??= e; }));
    }
  };
  const loop = Promise.all(Array.from({ length: INFLIGHT }, worker));
  return {
    t0,
    /** screenshots taken so far, repeats included: the capture rate, whatever the page did */
    get shots() { return shots; },
    /** ms since start, wall clock */
    now: () => performance.now() - t0,
    async stop() {
      running = false;
      await loop;
      await Promise.all(writes);
      if (failed) throw new Error(`cannot write frames to ${dir}: ${failed.message}`);
      // a still ending: the last frame holds until the last screenshot, so the clip keeps its full length
      if (frames.length && lastWall > frames.at(-1).wall) frames.push({ ...frames.at(-1), wall: lastWall, bytes: 0 });
      return frames;
    },
  };
}
