// take without Chrome: what it refuses before recording, and how the frame recorder fails when it can't write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { recorder } from "../src/browser.mjs";

const REC = join(import.meta.dirname, "..", "bin", "autocap.mjs");

test("a frame that can't be written ends the recording with a clear error instead of crashing", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "rec-frames-")), "frames");
  const cdp = { send: () => new Promise((r) => setTimeout(() => r({ data: Buffer.from("jpeg").toString("base64") }), 5)) };
  const rec = recorder(cdp, { dir, clip: { x: 0, y: 0, width: 10, height: 10 }, scale: 1 });
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(dir, "a file where the frames folder was"); // every later write fails with ENOTDIR
  await new Promise((r) => setTimeout(r, 60));
  await assert.rejects(rec.stop(), /cannot write frames/);
});
