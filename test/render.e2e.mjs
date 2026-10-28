// The camera renderer (ffmpeg + Python/Pillow, no Chrome): a render that didn't produce the clip must not pass.
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

test("a render whose source clip is missing fails", () => {
  assert.throws(() => render(take(0)));
});

test("a render whose source is far shorter than its timeline fails instead of writing a short clip", () => {
  assert.throws(() => render(take(0.2)));
});

test("a render of a whole source succeeds", () => {
  assert.match(render(take(2)), /smart\.mp4$/);
});
