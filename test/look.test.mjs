// rec look on a synthetic take: the framing report must say whether the camera had each marked box in view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REC = join(import.meta.dirname, "..", "bin", "rec.mjs");
const W = 1440, H = 900;
const A = { x: 100, y: 120, w: 160, h: 40 }; // top left: the camera frames it
const B = { x: 1180, y: 740, w: 160, h: 40 }; // bottom right: cam "hold" keeps the camera on A
const intersect = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function take() {
  const dir = mkdtempSync(join(tmpdir(), "rec-look-"));
  writeFileSync(join(dir, "rec.config.mjs"), `export default { url: "http://127.0.0.1:9/", out: "assets", shots: [{ id: "demo.frame", title: "t", steps: [] }, { id: "demo.none", title: "n", steps: [] }] };`);
  const eff = join(dir, "assets", "effects", "demo.frame");
  mkdirSync(eff, { recursive: true });
  const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=60:duration=3", "-pix_fmt", "yuv420p", join(eff, "smart.mp4")]);
  assert.equal(ff.status, 0, String(ff.stderr));
  writeFileSync(join(eff, "smart.cut.json"), JSON.stringify({ file: "smart.mp4", aspect: "16:9", cam: {} }));
  const click = (i, atMs, box, more = {}) => ({ i, verb: "click", atMs, box, ...more });
  writeFileSync(join(eff, "timeline.json"), JSON.stringify({
    version: 2, viewport: { w: W, h: H, dpr: 2 }, durationMs: 3000, cam: { end: "hold" }, cursor: [],
    marks: [{ atMs: 800, what: "beat A", box: A }, { atMs: 2000, what: "beat B", box: B }],
    events: [click(0, 800, A, { beat: "beat A" }), click(1, 2000, B, { cam: "hold", beat: "beat B" })],
  }));
  mkdirSync(join(dir, "assets", ".manifest"), { recursive: true });
  writeFileSync(join(dir, "assets", ".manifest", "effect.demo.frame.json"), JSON.stringify({ id: "effect.demo.frame", capturedFps: 60, durationMs: 3000 }));
  return dir;
}
const look = (dir, ...args) => spawnSync(process.execPath, [REC, "look", ...args], { cwd: dir, encoding: "utf8", timeout: 120000 });

test("look says in frame when the camera holds the box and out of frame when it was cropped away", () => {
  const dir = take();
  const r = look(dir, "demo.frame", "--json");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  const [a, b] = out.moments;
  assert.equal(a.inFrame, true);
  assert.ok(a.coverage >= 0.9, `A coverage ${a.coverage}`);
  assert.equal(b.inFrame, false);
  // independent geometry: the reported camera view on B really misses B and still contains A
  assert.ok(intersect(b.camera, B) / (B.w * B.h) < 0.1, "B is outside the reported camera view");
  assert.ok(intersect(b.camera, A) / (A.w * A.h) >= 0.9, "camera stayed on A");
  assert.ok(b.coverage < 0.1, `B coverage ${b.coverage}`);
  assert.ok(a.zoom > 1.5, `zoomed in on A: ${a.zoom}`);
  assert.match(r.stderr, /beat B/);
  const png = readFileSync(out.sheet);
  assert.ok(existsSync(out.sheet) && png.subarray(1, 4).toString() === "PNG");
});

test("look exits 2 with a hint when the shot has no take", () => {
  const r = look(take(), "demo.none");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no take for demo\.none; run rec take demo\.none/);
});
