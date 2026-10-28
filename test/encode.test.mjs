// Frames → clip with ffmpeg (no Chrome): paths that are legal on disk must encode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { encodeMp4 } from "../src/encode.mjs";

test("frames in a folder whose name has an apostrophe encode to a clip", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "rec-enc-")), "Tom's demo");
  mkdirSync(dir);
  const ff = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10:duration=1", join(dir, "f%05d.jpg")]);
  assert.equal(ff.status, 0, String(ff.stderr));
  const frames = Array.from({ length: 10 }, (_, i) => ({ file: join(dir, `f${String(i + 1).padStart(5, "0")}.jpg`), wall: i * 100 }));
  encodeMp4(frames, join(dir, "out.mp4"), { rate: 1 });
  assert.ok(statSync(join(dir, "out.mp4")).size > 1000);
});
