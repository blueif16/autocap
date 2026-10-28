// take without Chrome: what it refuses before recording, and how the frame recorder fails when it can't write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { recorder } from "../src/browser.mjs";

const REC = join(import.meta.dirname, "..", "bin", "autocap.mjs");
// What Page.getLayoutMetrics answers for an unscrolled 10x10 page (the recorder reads the scroll offset before each shot).
const LAYOUT = { cssVisualViewport: { offsetX: 0, offsetY: 0, pageX: 0, pageY: 0, clientWidth: 10, clientHeight: 10, scale: 1, zoom: 1 } };

test("take refuses to record without ffmpeg, before it launches Chrome", () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-preflight-"));
  writeFileSync(join(dir, "rec.config.mjs"), `export default { url: "http://127.0.0.1:9/", shots: [{ id: "a.b", title: "t", steps: [{ wait: 100 }] }] };`);
  // A fake Chrome: if take got as far as launching, the shot would fail with exit 1 instead.
  const env = { ...process.env, PATH: "/nonexistent", REC_CHROME: "/usr/bin/false" };
  const r = spawnSync(process.execPath, [REC, "take", "--json"], { cwd: dir, encoding: "utf8", env });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.match(doc.error, /ffmpeg/);
  assert.ok(doc.fix);
});

test("a frame that can't be written ends the recording with a clear error instead of crashing", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "rec-frames-")), "frames");
  const cdp = { send: (m) => (m === "Page.getLayoutMetrics" ? Promise.resolve(LAYOUT) : new Promise((r) => setTimeout(() => r({ data: Buffer.from("jpeg").toString("base64") }), 5))) };
  const rec = recorder(cdp, { dir, clip: { x: 0, y: 0, width: 10, height: 10 }, scale: 1 });
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(dir, "a file where the frames folder was"); // every later write fails with ENOTDIR
  await new Promise((r) => setTimeout(r, 60));
  await assert.rejects(rec.stop(), /cannot write frames/);
});

// A fake CDP whose screenshots take 20 ms and can overlap, like Chrome's (measured: 2 in flight doubles the rate).
function fakeCdp({ ms = 20, same = () => false } = {}) {
  const state = { inflight: 0, max: 0, n: 0 };
  const send = async (method) => {
    if (method === "Page.getLayoutMetrics") return LAYOUT;
    state.max = Math.max(state.max, ++state.inflight);
    await new Promise((r) => setTimeout(r, ms));
    state.inflight--;
    const n = state.n++;
    return { data: Buffer.from(same(n) ? "same" : `frame ${n}`).toString("base64") };
  };
  return { state, cdp: { send } };
}
const tmpFrames = () => join(mkdtempSync(join(tmpdir(), "rec-frames-")), "frames");

test("the recorder keeps two screenshots in flight", async () => {
  const { state, cdp } = fakeCdp();
  const rec = recorder(cdp, { dir: tmpFrames(), clip: { x: 0, y: 0, width: 10, height: 10 }, scale: 1 });
  await new Promise((r) => setTimeout(r, 400));
  const frames = await rec.stop();
  assert.equal(state.max, 2);
  assert.ok(frames.length >= 30, `${frames.length} frames in 400 ms at 20 ms each`);
});

test("the recorder drops a screenshot identical to the one before it, and its stamps only move forward", async () => {
  const { cdp } = fakeCdp({ same: (n) => n % 3 !== 0 }); // runs of identical frames
  const rec = recorder(cdp, { dir: tmpFrames(), clip: { x: 0, y: 0, width: 10, height: 10 }, scale: 1 });
  await new Promise((r) => setTimeout(r, 300));
  const frames = await rec.stop();
  const files = [...new Set(frames.map((f) => f.file))].map((f) => readFileSync(f, "utf8")); // each file written, in order
  assert.ok(files.every((d, i) => i === 0 || d !== files[i - 1]), "a repeat was written as a new frame");
  assert.ok(frames.every((f, i) => i === 0 || f.wall > frames[i - 1].wall), "stamps go backwards");
});

test("a still ending is kept: the recording lasts until the last screenshot, not the last change", async () => {
  const { cdp } = fakeCdp({ same: (n) => n >= 2 }); // the page stops changing after two frames
  const rec = recorder(cdp, { dir: tmpFrames(), clip: { x: 0, y: 0, width: 10, height: 10 }, scale: 1 });
  await new Promise((r) => setTimeout(r, 300));
  const stopAt = rec.now();
  const frames = await rec.stop();
  assert.ok(stopAt - frames.at(-1).wall < 60, `recording ends ${Math.round(stopAt - frames.at(-1).wall)} ms before stop`);
});
