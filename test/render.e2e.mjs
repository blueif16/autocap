// The camera renderer (ffmpeg + sharp, no Chrome): a render that didn't produce the clip must not pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { render } from "../src/camera.mjs";

function take(sourceSeconds) {
  const dir = mkdtempSync(join(tmpdir(), "rec-render-"));
  writeFileSync(join(dir, "timeline.json"), JSON.stringify({ version: 2, viewport: { w: 320, h: 180, dpr: 1 }, durationMs: 2000, cam: {}, marks: [], cursor: [], events: [] }));
  if (sourceSeconds) {
    const ff = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `testsrc=size=320x180:rate=60:duration=${sourceSeconds}`, "-pix_fmt", "yuv420p", join(dir, "full.mp4")]);
    assert.equal(ff.status, 0, String(ff.stderr));
  }
  return dir;
}

test("a render whose source clip is missing fails", async () => {
  await assert.rejects(render(take(0)));
});

test("a render whose source is far shorter than its timeline fails instead of writing a short clip", async () => {
  await assert.rejects(render(take(0.2)));
});

test("a render of a whole source succeeds", async () => {
  assert.match(await render(take(2)), /smart\.mp4$/);
});

// A 4 px white line at x = 1000.5 (source px) on grey, the camera panning 0.07 px per frame at 1.5x zoom: in the
// output the line must sit where the box puts it (±0.3 px) and move smoothly (no whole-pixel steps).
test("the renderer places a sub-pixel camera box exactly and pans smoothly", async () => {
  const { renderBoxes } = await import("../src/camera.mjs");
  const dir = mkdtempSync(join(tmpdir(), "rec-subpx-"));
  const SW = 2880, SH = 1800, LINE = 1000.5, N = 90;
  const ff = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=0x404040:size=${SW}x${SH}:rate=60:duration=${N / 60}`,
    "-vf", `drawbox=x=${LINE - 2 + 0.5}:y=0:w=4:h=${SH}:color=white:t=fill`, "-pix_fmt", "yuv444p", "-c:v", "libx264", "-crf", "0", join(dir, "full.mp4")]);
  assert.equal(ff.status, 0, String(ff.stderr));
  const bw = SW / 1.5; // a 16:9 box at 1.5x zoom
  const boxes = Array.from({ length: N }, (_, i) => [600 + i * 0.07, 300, bw, (bw * 9) / 16]);
  const out = await renderBoxes(join(dir, "full.mp4"), join(dir, "smart.mp4"), { src: [SW, SH], out: [1920, 1080], fps: 60, boxes });
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", out, "-vf", "crop=1920:4:0:540,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 }).stdout;
  const row = 1920 * 4;
  const xs = [];
  for (let f = 0; f < raw.length / row; f++) {
    let sx = 0, sw = 0;
    for (let i = 0; i < row; i++) { const v = Math.max(0, raw[f * row + i] - 70); sx += (i % 1920) * v; sw += v; }
    xs.push(sx / sw);
  }
  assert.equal(xs.length, N);
  const s = 1920 / bw;
  // pixel i covers [i, i+1): the line's centre is at LINE + 0.5 in the source, and at index X + 0.5 in the output
  const err = xs.map((x, i) => Math.abs(x - ((LINE + 0.5 - boxes[i][0]) * s - 0.5)));
  const d2 = xs.slice(2).map((x, i) => x - 2 * xs[i + 1] + xs[i]);
  const rms = Math.sqrt(d2.reduce((a, v) => a + v * v, 0) / d2.length);
  assert.ok(Math.max(...err) < 0.3, `max placement error ${Math.max(...err).toFixed(3)} px`);
  assert.ok(rms < 0.15, `second-difference RMS ${rms.toFixed(3)} px (whole-pixel steps)`);
});
