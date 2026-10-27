// One take of one shot. Per shot, in <out>/effects/<id>/:
//   smart.mp4   1920x1080 60 fps, auto-zoom camera: pushes in on each marked element, follows the cursor (camera.mjs)
//   full.mp4    the whole window at device pixels, 60 fps, real speed (for any reframing)
//   focus.mp4   16:9 crop around where the action happens, real speed
//   slowmo.mp4  the focus crop at 1/slowmo speed (captured at 150+ fps of page time, so it's true slow motion)
//   poster.png  the payoff frame, focus crop
//   timeline.json  cursor path, clicks and marked moments in ms + boxes in CSS px (× dpr for device px)
// and an entry in <out>/manifest.json saying what it shows and why (feature, demonstrates, moments).
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { launch, setRate, recorder, CLEAN_CSS } from "./browser.mjs";
import { encodeMp4, poster } from "./encode.mjs";
import { installStage } from "./stage.mjs";
import { Director } from "./director.mjs";
import { render as renderSmart } from "./camera.mjs";
import { addToManifest, rel } from "./manifest.mjs";
import { runSteps } from "./steps.mjs";

// Hides dev chrome on every document the shot loads (a `goto` step loses styles added after load).
const CSS = (css) => {
  const add = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", add) : add();
};

const ts = (ms) => new Date(Math.max(0, ms)).toISOString().slice(11, 23).replace(".", ",");
/** captions.srt from the steps' `say` text: each caption runs until the next one (at most 3 s). */
function srt(events, durationMs) {
  const says = events.filter((e) => e.say);
  return says.map((e, i) => `${i + 1}\n${ts(e.atMs)} --> ${ts(Math.min(says[i + 1]?.atMs ?? Infinity, e.atMs + 3000, durationMs))}\n${e.say}\n`).join("\n");
}

/** The smallest 16:9 box (≥ half the window) holding `b` plus padding, kept inside the window. */
function frame16x9(b, W, H, pad = 110) {
  let w = Math.max(b.w + pad * 2, W / 2), h = Math.max(b.h + pad * 2, (W / 2) * 9 / 16);
  if (w / h > 16 / 9) h = w * 9 / 16; else w = h * 16 / 9;
  w = Math.min(w, W); h = Math.min(h, H);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), W - w), y = Math.min(Math.max(cy - h / 2, 0), H - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function union(boxes) {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

// One real recording at a time across every process (parallel captures pushed a 16 GB Mac into swap: 3 fps of page
// time). Check runs skip the lock. The lock is a directory holding the owner's pid; a dead owner's lock is taken over.
async function withRecordLock(out, fn) {
  const LOCK = join(out, ".record.lock");
  mkdirSync(out, { recursive: true });
  for (let waited = 0; ; waited += 2) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "pid"), String(process.pid));
      break;
    } catch {
      const owner = Number(existsSync(join(LOCK, "pid")) ? readFileSync(join(LOCK, "pid"), "utf8") : 0);
      let alive = false;
      try { if (owner) { process.kill(owner, 0); alive = true; } } catch {}
      if (!alive && waited > 4) rmSync(LOCK, { recursive: true, force: true });
      if (waited % 30 === 0) console.log(`  waiting for another recording to finish (${waited}s)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

/**
 * Records one shot; if the clip has < 60 fps of page time (machine under memory pressure), retries once at a slower
 * page speed. check: full speed, no recording or encoding, a screenshot in <out>/.debug/ when the shot fails or ends.
 */
export async function take(shot, cfg, { check = false } = {}) {
  // 0.1: even when the machine is busy (~10 fps of retina screenshots), that's 100 fps of page time.
  let rate = check ? 1 : Number(process.env.REC_RATE ?? 0.1);
  if (check) return captureOnce(shot, cfg, rate, true);
  return withRecordLock(cfg.out, async () => {
    for (let attempt = 0; ; attempt++) {
      const r = await captureOnce(shot, cfg, rate, false);
      if (r.fps >= 60 || attempt >= 1) return r;
      rate = Math.max(0.05, (rate * r.fps) / 100);
      console.log(`  only ${r.fps} fps of page time; re-recording at ${rate.toFixed(3)}× page speed`);
    }
  });
}

async function captureOnce(shot, cfg, rate, check) {
  console.log(`● ${shot.id}`);
  const { width: W, height: H, dpr } = cfg.viewport;
  const s = await launch({ width: W, height: H, dpr, chrome: cfg.chrome });
  const { page, browser } = s;
  if (check && cfg.console) page.on("console", (m) => cfg.console.test(m.text()) && console.log("  " + m.text()));
  page.setDefaultTimeout(8000 / rate); // Playwright waits are wall-clock; the page runs rate× slower
  try {
    return await captureIn(shot, cfg, s, rate, check);
  } catch (e) {
    mkdirSync(join(cfg.out, ".debug"), { recursive: true });
    const shotPath = join(cfg.out, ".debug", `${shot.id}.png`);
    if (await page.screenshot({ path: shotPath }).then(() => true, () => false)) e.screenshot = shotPath;
    throw e;
  } finally {
    await browser.close().catch(() => {});
    rmSync(join(cfg.out, ".frames", shot.id), { recursive: true, force: true }); // a failed take must not leave GBs behind
  }
}

async function captureIn(shot, cfg, { page, cdp, browser }, rate, check) {
  const { width: W, height: H, dpr: DPR } = cfg.viewport;
  const stage = { ...cfg.stage, ...shot.stage };
  await installStage(page, stage);
  await page.addInitScript(CSS, CLEAN_CSS + cfg.css);
  await cfg.prepare?.({ page, shot });
  if (shot.routes) await shot.routes(page);
  await page.goto(shot.path ? new URL(shot.path, cfg.url).href : cfg.url, { waitUntil: "load", timeout: 90000 }); // a dev server may be compiling
  await page.waitForTimeout(1500);
  const start = { x: Math.round(W * 0.903), y: Math.round(H * 0.911) };
  const d = new Director(page, rate, start);
  await d.place(start.x, start.y);
  if (Array.isArray(shot.setup)) {
    const sd = new Director(page, 1, d.pos); // setup runs before the clock is slowed
    await runSteps(shot.setup, { page, d: sd, cfg });
    d.pos = sd.pos;
  } else await shot.setup?.({ page, d });
  await page.waitForTimeout(600);
  console.log("  setup done, recording");

  await setRate(page, cdp, rate);
  const dir = join(cfg.out, ".frames", shot.id);
  const rec = recorder(cdp, { dir, clip: { x: 0, y: 0, width: W, height: H }, scale: DPR });
  d.start(rec);
  let frames;
  try {
    await d.wait(shot.lead ?? 300);
    if (shot.steps) await runSteps(shot.steps, { page, d, cfg });
    else await shot.act({ page, d });
    await d.wait(shot.tail ?? 900);
  } finally {
    frames = await rec.stop();
  }
  if (check) {
    mkdirSync(join(cfg.out, ".debug"), { recursive: true });
    await page.screenshot({ path: join(cfg.out, ".debug", `${shot.id}.png`) });
    rmSync(dir, { recursive: true, force: true });
    console.log("  check: marks", JSON.stringify(d.marks.map((m) => m.what)));
    return { beats: d.marks.map((m) => m.what), steps: d.events.length, screenshot: join(cfg.out, ".debug", `${shot.id}.png`) };
  }
  const focusBox = shot.focus ? await shot.focus({ page, d }) : null;
  await browser.close();

  const SLOW = cfg.slowmo;
  const durationMs = Math.round((frames.at(-1).wall - frames[0].wall) * rate);
  const boxes = d.marks.filter((m) => m.box).map((m) => m.box);
  const focus = frame16x9(focusBox ?? (boxes.length ? union(boxes) : { x: 0, y: 0, w: W, h: H }), W, H, shot.pad);
  const crop = { x: focus.x * DPR, y: focus.y * DPR, w: focus.w * DPR, h: focus.h * DPR };
  const out = join(cfg.out, "effects", shot.id);
  mkdirSync(out, { recursive: true });
  encodeMp4(frames, join(out, "full.mp4"), { rate });
  encodeMp4(frames, join(out, "focus.mp4"), { rate, crop });
  encodeMp4(frames, join(out, "slowmo.mp4"), { rate, crop, stretch: SLOW });
  const payoff = shot.posterAtMs ?? (d.marks.at(-1)?.atMs ?? durationMs * 0.6) + 500;
  const pf = frames.reduce((best, f) => (Math.abs(f.wall * rate - payoff) < Math.abs(best.wall * rate - payoff) ? f : best), frames[0]);
  poster(pf.file, join(out, "poster.png"), crop);
  const timeline = { ...(shot.steps ? { version: 2, cam: shot.cam ?? {} } : {}), viewport: { w: W, h: H, dpr: DPR }, durationMs, focus, marks: d.marks, cursor: d.cursor, ...(shot.steps ? { events: d.events } : {}) };
  writeFileSync(join(out, "timeline.json"), JSON.stringify(timeline, null, 1));
  const captions = srt(d.events, durationMs);
  rmSync(join(out, "captions.srt"), { force: true });
  if (captions) writeFileSync(join(out, "captions.srt"), captions);
  rmSync(dir, { recursive: true, force: true });
  renderSmart(out, { python: cfg.python }); // smart.mp4: auto-zoom camera from the timeline's boxes and cursor

  const capturedFps = Math.round(frames.length / (durationMs / 1000));
  const r = (p) => rel(cfg.out, p);
  addToManifest(cfg.out, {
    id: `effect.${shot.id}`,
    kind: "effect",
    feature: shot.feature,
    title: shot.title,
    demonstrates: shot.demonstrates,
    suggestedUse: shot.suggestedUse,
    moments: d.marks.map(({ atMs, what }) => ({ atMs, what })),
    files: { smart: r(join(out, "smart.mp4")), full: r(join(out, "full.mp4")), focus: r(join(out, "focus.mp4")), slowmo: r(join(out, "slowmo.mp4")), poster: r(join(out, "poster.png")), timeline: r(join(out, "timeline.json")), ...(captions ? { captions: r(join(out, "captions.srt")) } : {}) },
    size: { full: [W * DPR, H * DPR], focus: [crop.w, crop.h] },
    focusBoxCss: focus,
    fps: 60,
    capturedFps,
    durationMs,
    slowmoFactor: SLOW,
    cursor: stage.cursor,
    staged: shot.staged ?? null,
    alpha: false,
  }, cfg.features);
  console.log(`  ${frames.length} frames, ${capturedFps} fps of page time, ${(durationMs / 1000).toFixed(1)} s, focus ${focus.w}x${focus.h}`);
  return { fps: capturedFps, durationMs, dir: out, beats: d.marks.map((m) => m.what) };
}
