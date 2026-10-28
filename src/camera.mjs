// Smart camera: re-frames a take (full.mp4, the whole window at device pixels) into a 1920x1080 clip whose camera
// pushes in on what is being acted on and follows the cursor, like Screen Studio's auto-zoom.
// Reads <take>/timeline.json (marks with element boxes, the cursor path) → writes <take>/smart.mp4.
// The plan: a keyframe per marked box (framed with padding, zoom ≤ MAX_ZOOM), arriving shortly before the moment;
// far jumps go out-then-in; the cursor is kept in frame; the whole path runs through a spring so it feels physical.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const FPS = 60;
const MAX_ZOOM = 2.4; // code shots (timeline v1): narrowest view = 1/2.4 of the window width (600 CSS px of 1440)
// Steps shots: 2x, the moderate preset of comparable tools (Tella, screenforge; OpenScreen uses 1.8). At 2.4 every
// small target landed at the limit and the viewer saw the label, not the result (dogfood, .tasks/research/B-dogfood.md).
const STEPS_MAX = 2;
const PAD = 70; // CSS px around a framed element
const LEAD = 700, ARRIVE = 160; // start moving LEAD ms before a moment, be there ARRIVE ms before it

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const FEEL = { smooth: 170, snappy: 420, gentle: 90 }; // spring stiffness
const ASPECT = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1] };
/** [width, height] ratio from "16:9" | "9:16" | "1:1" or a number (width / height). */
const ratio = (a = "16:9") => (typeof a === "number" ? [a, 1] : ASPECT[a] ?? ASPECT["16:9"]);
const hOf = (w, [n, d]) => (w * d) / n;

function frameFor(box, W, H, ar, { max = MAX_ZOOM, pad = PAD } = {}) {
  const [n, d] = ar;
  const minW = Math.min(W, (H * n) / d) / max;
  let w = Math.max(box.w + pad * 2, ((box.h + pad * 2) * n) / d, minW);
  w = Math.min(w, W, (H * n) / d);
  return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, w };
}

function clampCam(c, W, H, ar = ASPECT["16:9"]) {
  const [n, d] = ar;
  const w = Math.min(c.w, W, (H * n) / d), h = hOf(w, ar);
  return { w, cx: Math.min(Math.max(c.cx, w / 2), W - w / 2), cy: Math.min(Math.max(c.cy, h / 2), H - h / 2) };
}

/** The camera's view in CSS px for a path point. */
export function rect(c, aspect = "16:9") {
  const h = hOf(c.w, ratio(aspect));
  return { x: c.cx - c.w / 2, y: c.cy - h / 2, w: c.w, h };
}

/** Shot camera settings: timelines from step shots (version 2) end wide; code shots keep their original look. */
export const camSettings = (tl, over = {}) => ({ auto: "all", feel: "smooth", max: tl.version >= 2 ? STEPS_MAX : MAX_ZOOM, pad: PAD, end: tl.version >= 2 ? "wide" : "hold", ...tl.cam, ...over });

const AUTO = {
  all: () => true,
  clicks: (e) => ["click", "type", "select", "drag"].includes(e.verb),
  beats: (e) => !!e.beat || e.verb === "see",
  off: () => false,
};

/** What the camera does at each step: { t, mode: frame|wide|hold|pan, box?, level?, region?, cut?, follow? }. */
function targets(tl, cam) {
  if (!tl.events) return tl.marks.filter((m) => m.box).map((m) => ({ t: m.atMs, mode: "frame", box: m.box }));
  return tl.events.filter((e) => !e.skipped).flatMap((e) => {
    const t = e.atMs, box = e.region ?? e.box, level = e.zoom, region = !!e.region;
    if (e.cam === "wide") return [{ t, mode: "wide" }];
    if (e.cam === "hold") return [{ t, mode: "hold" }];
    if (!box) return [];
    if (e.cam === "pan") return [{ t, mode: "pan", box }];
    if (e.cam === "cut") return [{ t, mode: "frame", box, level, region, cut: true }];
    if (e.cam === "follow") return [{ t, mode: "frame", box, level, follow: "track" }];
    if (e.cam === "zoom" || level || region) return [{ t, mode: "frame", box, level, region, ...(region ? { follow: "off" } : {}) }];
    return AUTO[cam.auto](e) ? [{ t, mode: "frame", box }] : [];
  });
}

export function plan(tl, opts = {}) {
  const { w: W, h: H } = tl.viewport;
  const ar = ratio(opts.aspect);
  const cam = camSettings(tl, opts.cam);
  const wideW = Math.min(W, (H * ar[0]) / ar[1]);
  // The overview: the whole window, or for a narrower cut (9:16, 1:1) the widest view centered on where the action is.
  const boxes = (tl.events ?? tl.marks).filter((e) => !e.skipped && (e.region ?? e.box)).map((e) => e.region ?? e.box);
  const ax = boxes.length ? (Math.min(...boxes.map((b) => b.x)) + Math.max(...boxes.map((b) => b.x + b.w))) / 2 : W / 2;
  const wide = clampCam({ cx: ax, cy: H / 2, w: W }, W, H, ar);
  const keys = [{ t: 0, ...wide }];
  const pos = (k) => ({ cx: k.cx, cy: k.cy, w: k.w });
  // Code-shot timelines keep the original planner's quirk: `{ t: tStart, ...prev }` let prev.t win, so the camera
  // drifts toward the next target from the previous arrival instead of holding. Recorded footage depends on it.
  const from = (t, k) => (tl.version >= 2 ? { t, ...pos(k) } : { t, ...k });
  for (const g of targets(tl, cam)) {
    const prev = keys[keys.length - 1];
    if (g.mode === "hold") {
      keys.push({ t: Math.max(prev.t, g.t), ...pos(prev), follow: "off" });
      continue;
    }
    let target;
    if (g.mode === "wide") target = wide;
    else if (g.mode === "pan") target = clampCam({ cx: g.box.x + g.box.w / 2, cy: g.box.y + g.box.h / 2, w: prev.w }, W, H, ar);
    else if (g.level) target = clampCam({ cx: g.box.x + g.box.w / 2, cy: g.box.y + g.box.h / 2, w: wideW / g.level }, W, H, ar); // a step's zoom is exact
    else if (g.region) target = clampCam({ cx: g.box.x + g.box.w / 2, cy: g.box.y + g.box.h / 2, w: Math.max(g.box.w, (g.box.h * ar[0]) / ar[1]) }, W, H, ar);
    else target = clampCam(frameFor(g.box, W, H, ar, cam), W, H, ar);
    const extra = { ...(g.follow ? { follow: g.follow } : {}) };
    if (g.cut) {
      const t = Math.max(prev.t, g.t);
      keys.push({ t, ...pos(prev) }, { t, ...target, snap: true, ...extra });
      continue;
    }
    const tArrive = Math.max(prev.t + 200, g.t - ARRIVE);
    const tStart = Math.max(prev.t, tArrive - LEAD);
    const dist = Math.hypot(target.cx - prev.cx, target.cy - prev.cy);
    // Far apart while zoomed in: pull out on the way, then push in.
    if (g.mode === "frame" && dist > Math.min(prev.w, target.w) * 0.75 && tArrive - tStart > 400) {
      const mid = clampCam({ cx: (prev.cx + target.cx) / 2, cy: (prev.cy + target.cy) / 2, w: Math.min(W, Math.max(prev.w, target.w) + dist) }, W, H, ar);
      keys.push(from(tStart, prev), { t: (tStart + tArrive) / 2, ...mid });
    } else {
      keys.push(from(tStart, prev));
    }
    keys.push({ t: tArrive, ...target, ...extra });
  }
  if (cam.end === "wide") {
    const prev = keys[keys.length - 1];
    const tArrive = Math.max(prev.t + 200, tl.durationMs - 450);
    keys.push({ t: Math.max(prev.t, tArrive - 900), ...pos(prev) }, { t: tArrive, ...wide });
  }
  return keys;
}

function camAt(keys, t) {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t < b.t) {
      const e = easeInOut((t - a.t) / (b.t - a.t));
      // Zoom interpolates in log space, so a push-in feels even.
      return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, w: Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * e) };
    }
  }
  return keys[keys.length - 1];
}

function cursorAt(cursor, t) {
  let c = null;
  for (const p of cursor) if (p.atMs <= t) c = p; else break;
  return c;
}

export function path(tl, opts = {}) {
  const { w: W, h: H } = tl.viewport;
  const ar = ratio(opts.aspect);
  const cam = camSettings(tl, opts.cam);
  const keys = plan(tl, opts);
  const n = Math.round((tl.durationMs / 1000) * FPS);
  const out = [];
  let s = null, v = { cx: 0, cy: 0, w: 0 };
  const k = FEEL[cam.feel] ?? FEEL.smooth, damp = 2 * Math.sqrt(k) * 1.0, dt = 1 / FPS; // critically damped spring
  let ki = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / FPS) * 1000;
    let c = { ...camAt(keys, t) };
    let snap = false;
    while (ki + 1 < keys.length && keys[ki + 1].t <= t) {
      ki++;
      if (keys[ki].snap) snap = true;
    }
    const follow = keys[ki].follow ?? "nudge";
    const p = cursorAt(tl.cursor, t);
    if (p && follow === "nudge" && t - p.atMs < 600) {
      // Keep a moving cursor inside the frame; once it has rested 600 ms the marked moment owns the shot.
      const h = hOf(c.w, ar), m = c.w * 0.08;
      if (p.x < c.cx - c.w / 2 + m) c.cx = p.x - m + c.w / 2;
      if (p.x > c.cx + c.w / 2 - m) c.cx = p.x + m - c.w / 2;
      if (p.y < c.cy - h / 2 + m) c.cy = p.y - m + h / 2;
      if (p.y > c.cy + h / 2 - m) c.cy = p.y + m - h / 2;
    } else if (p && follow === "track") {
      // Follow: the cursor stays inside the middle half of the frame, moving or not.
      const h = hOf(c.w, ar), mx = c.w * 0.25, my = h * 0.25;
      if (p.x < c.cx - c.w / 2 + mx) c.cx = p.x - mx + c.w / 2;
      if (p.x > c.cx + c.w / 2 - mx) c.cx = p.x + mx - c.w / 2;
      if (p.y < c.cy - h / 2 + my) c.cy = p.y - my + h / 2;
      if (p.y > c.cy + h / 2 - my) c.cy = p.y + my - h / 2;
    }
    c = clampCam(c, W, H, ar);
    if (!s || snap) {
      s = { ...c };
      v = { cx: 0, cy: 0, w: 0 };
    }
    for (const key of ["cx", "cy", "w"]) {
      const a = k * (c[key] - s[key]) - damp * v[key];
      v[key] += a * dt;
      s[key] += v[key] * dt;
    }
    out.push(clampCam(s, W, H, ar));
  }
  return out;
}

const RENDERER = join(import.meta.dirname, "camera_render.py");

/** The Python that runs the renderer (needs Pillow): config `python`, else $REC_PYTHON, else uv with Pillow, else python3. */
function python(explicit) {
  if (explicit) return [explicit];
  if (process.env.REC_PYTHON) return [process.env.REC_PYTHON];
  if (spawnSync("uv", ["--version"]).status === 0) return ["uv", "run", "--no-project", "--quiet", "--with", "pillow", "python"];
  return ["python3"];
}

const SIZE = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] };

/**
 * Renders a cut of <dir>/full.mp4 driven by <dir>/timeline.json; returns its path.
 * aspect "16:9" | "9:16" | "1:1"; cam overrides the shot's camera settings (e.g. { auto: "off" }); name the output file.
 */
export function render(dir, { python: py, aspect = "16:9", cam, name = "smart.mp4" } = {}) {
  const tl = JSON.parse(readFileSync(join(dir, "timeline.json"), "utf8"));
  const dpr = tl.viewport.dpr, ar = ratio(aspect);
  const boxes = path(tl, { aspect, cam }).map((c) => {
    const w = c.w * dpr, h = hOf(c.w, ar) * dpr;
    return [(c.cx * dpr) - w / 2, (c.cy * dpr) - h / 2, w, h].map((v) => Math.round(v * 100) / 100);
  });
  const camFile = join(dir, `.camera-${process.pid}.json`);
  writeFileSync(camFile, JSON.stringify({ src: [tl.viewport.w * dpr, tl.viewport.h * dpr], out: SIZE[aspect] ?? SIZE["16:9"], fps: FPS, boxes }));
  const [cmd, ...args] = python(py);
  const out = join(dir, name);
  try {
    execFileSync(cmd, [...args, RENDERER, join(dir, "full.mp4"), out, camFile], { stdio: ["ignore", "ignore", "inherit"] });
  } catch (e) {
    rmSync(out, { force: true }); // never leave a partial cut where look would read it
    throw new Error(`the camera render of ${out} failed (see above)`);
  } finally {
    rmSync(camFile, { force: true });
  }
  // How this cut was made, so `rec look` can rebuild the camera path for it.
  writeFileSync(out.replace(/\.mp4$/, ".cut.json"), JSON.stringify({ file: name, aspect, cam: camSettings(tl, cam), size: SIZE[aspect] ?? SIZE["16:9"] }, null, 1));
  return out;
}
