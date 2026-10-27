import { existsSync, readFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { launch } from "../browser.mjs";
import { RecError } from "../config.mjs";
import { path as camPath, rect } from "../camera.mjs";

export const usage = "look <shot> [--cut <file>] [--json]    contact sheet of a cut at each marked moment, whether the camera had the subject in frame, and any blank stretch";
export const config = "required";

const FPS = 60, TILE = 640, AFTER_MS = 100, IN_FRAME = 0.9;
// Blank check: sample the cut 4×/s as 320×180 luma. A frame is blank when under 0.5% of its pixels differ from its
// median by more than 8 levels. Calibrated on real takes: a page mid-transition measured 0.00%, real UI 14% to 91%.
const SAMPLE_FPS = 4, SW = 320, SH = 180, DIFF = 8, BLANK = 0.005;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

/** Width / height of "16:9" | "9:16" | "1:1" (or a number). */
function ratioOf(aspect) {
  if (typeof aspect === "number") return aspect;
  const [n, d] = String(aspect).split(":").map(Number);
  return n > 0 && d > 0 ? n / d : 16 / 9;
}

const area = (b) => b.w * b.h;
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Marks (beats), else events with a box, else 4 evenly spaced times. */
function momentsOf(tl, durationMs) {
  if (tl.marks?.length) return tl.marks.map((m) => ({ what: m.what ?? "mark", atMs: m.atMs, box: m.box ?? null }));
  const ev = (tl.events ?? []).filter((e) => e.box);
  if (ev.length) return ev.map((e) => ({ what: e.beat ?? e.verb ?? "step", atMs: e.atMs, box: e.box }));
  return [0, 1, 2, 3].map((i) => ({ what: `t${i + 1}`, atMs: Math.round((i * durationMs) / 4), box: null }));
}

function frameAt(file, sec) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(sec), "-i", file, "-frames:v", "1", "-vf", `scale=${TILE}:-2`, "-f", "image2pipe", "-vcodec", "png", "-"], { maxBuffer: 64 << 20 });
  if (r.error || r.status !== 0 || !r.stdout.length) throw new RecError(2, `cannot extract a frame at ${sec}s from ${file}: ${r.error?.message ?? String(r.stderr).trim()}`);
  return r.stdout;
}

/** Stretches of the cut where the frame shows nothing: [{ fromMs, toMs }]. */
function blankStretches(file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `fps=${SAMPLE_FPS},scale=${SW}:${SH},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) throw new RecError(2, `cannot sample ${file}: ${r.error?.message ?? String(r.stderr).trim()}`);
  const n = SW * SH, step = 1000 / SAMPLE_FPS, out = [];
  for (let f = 0; f < Math.floor(r.stdout.length / n); f++) {
    const px = r.stdout.subarray(f * n, (f + 1) * n);
    const hist = new Uint32Array(256);
    for (const v of px) hist[v]++;
    let med = 0;
    for (let acc = 0; (acc += hist[med]) < n / 2; med++);
    let detail = 0;
    for (let v = 0; v < 256; v++) if (Math.abs(v - med) > DIFF) detail += hist[v];
    if (detail / n >= BLANK) continue;
    const last = out.at(-1);
    if (last && last.toMs === f * step) last.toMs += step;
    else out.push({ fromMs: f * step, toMs: (f + 1) * step });
  }
  return out;
}

export async function run({ cfg, args, flags }) {
  if (args.length !== 1) throw new RecError(2, "rec look takes exactly one shot id");
  const shot = cfg.shots.find((s) => s.id === args[0]);
  if (!shot) throw new RecError(2, `no shot ${args[0]}`);
  const dir = join(cfg.out, "effects", shot.id);
  const tlFile = join(dir, "timeline.json");
  if (!existsSync(tlFile)) throw new RecError(2, `no take for ${shot.id}; run rec take ${shot.id}`);

  const cutName = flags.cut ?? "smart.mp4";
  const cutFile = join(dir, cutName);
  if (!existsSync(cutFile)) throw new RecError(2, `no cut ${cutName} in ${dir}`);
  const sidecar = join(dir, basename(cutName, extname(cutName)) + ".cut.json");
  let cut = { aspect: "16:9" };
  if (existsSync(sidecar)) cut = readJson(sidecar);
  else if (cutName !== "smart.mp4") throw new RecError(2, `no sidecar ${basename(sidecar)} for ${cutName} (cannot tell how it was framed)`);

  const tl = readJson(tlFile);
  const mf = join(cfg.out, ".manifest", `effect.${shot.id}.json`);
  const entry = existsSync(mf) ? readJson(mf) : {};
  const durationMs = entry.durationMs ?? tl.durationMs;
  const capturedFps = entry.capturedFps ?? null;
  const aspect = cut.aspect ?? "16:9";

  const { w: W, h: H } = tl.viewport;
  const widest = Math.min(W, H * ratioOf(aspect));
  const points = camPath(tl, { aspect, cam: cut.cam });
  const lastMs = Math.max(0, durationMs - 1000 / FPS);

  const moments = momentsOf(tl, durationMs).map((m, i) => {
    const t = Math.min(m.atMs + AFTER_MS, lastMs);
    const p = points[Math.min(points.length - 1, Math.max(0, Math.round((t / 1000) * FPS)))];
    const camera = rect(p, aspect);
    const coverage = m.box ? overlap(m.box, camera) / area(m.box) : null;
    return { n: i + 1, what: m.what, atMs: m.atMs, t, box: m.box, camera, zoom: widest / p.w, coverage, inFrame: coverage === null ? null : coverage >= IN_FRAME };
  });

  const blank = blankStretches(cutFile);
  for (const m of moments) {
    m.png = frameAt(cutFile, (m.t / 1000).toFixed(3));
    m.blank = blank.some((b) => m.t >= b.fromMs && m.t < b.toMs);
  }

  const mark = (m) => (m.inFrame === null ? "–" : m.inFrame ? "✓" : "✗");
  const caption = (m) => `#${m.n}  ${m.what} · ${(m.t / 1000).toFixed(2)} s · ${m.zoom.toFixed(1)}× · in frame ${mark(m)}${m.blank ? " · BLANK" : ""}`;
  const cols = Math.min(moments.length, 3);
  const tiles = moments.map((m) => `<figure class="${m.inFrame === false || m.blank ? "bad" : ""}"><img src="data:image/png;base64,${m.png.toString("base64")}"><figcaption>${esc(caption(m))}</figcaption></figure>`).join("");
  const sheet = join(dir, "look.png");
  const s = await launch({ width: cols * (TILE + 18) + 6, height: 100, dpr: 1, chrome: cfg.chrome }).catch((e) => {
    throw new RecError(2, `cannot start Chrome: ${e.message.split("\n")[0]}`);
  });
  try {
    await s.page.setContent(`<!doctype html><body style="margin:0;padding:6px;background:#fff;font:14px system-ui;color:#111">
<style>.g{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:${TILE + 2}px}img{width:${TILE}px;display:block;border:1px solid #ccc}figcaption{font-size:13px;padding:3px 0}.bad figcaption{color:#b91c1c;font-weight:600}</style><div class="g">${tiles}</div>`);
    await s.page.screenshot({ path: sheet, fullPage: true });
  } finally {
    await s.browser.close().catch(() => {});
  }

  const out = moments.map(({ n, what, atMs, box, camera, zoom, coverage, inFrame, blank }) => ({ n, what, atMs, box, camera, zoom, coverage, inFrame, blank }));
  const bad = out.filter((m) => m.inFrame === false);
  const ok = bad.length === 0 && blank.length === 0;
  if (flags.json) process.stdout.write(JSON.stringify({ ok, shot: shot.id, cut: cutName, sheet, durationMs, capturedFps, blank, moments: out }) + "\n");
  else {
    for (const m of moments) console.log(caption(m) + (m.coverage === null ? "" : `  coverage ${(m.coverage * 100).toFixed(0)}%`));
    console.log(`sheet: ${sheet}`);
  }
  if (bad.length) console.error(`rec: out of frame: ${bad.map((m) => `#${m.n} ${m.what} (coverage ${(m.coverage * 100).toFixed(0)}%)`).join(", ")}`);
  const sec = (ms) => (ms / 1000).toFixed(2);
  if (blank.length) console.error(`rec: blank frames at ${blank.map((b) => `${sec(b.fromMs)}–${sec(b.toMs)} s`).join(", ")}: the frame shows almost nothing (a page transition, a reload, or the camera on empty space). Check those times in the cut, then fix the step or re-take.`);
  return ok ? 0 : 1;
}
