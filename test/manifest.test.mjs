// The manifest: one damaged entry must not block every later take and cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addToManifest } from "../src/manifest.mjs";

const entry = (id) => ({ id, feature: "f", title: "t", demonstrates: "d", files: { smart: `effects/${id}/smart.mp4` } });

test("a truncated manifest entry is skipped, and the next take still lands in manifest.json", () => {
  const out = mkdtempSync(join(tmpdir(), "rec-manifest-"));
  mkdirSync(join(out, ".manifest"));
  writeFileSync(join(out, ".manifest", "effect.a.json"), '{"id":"effect.a","files":{"sm'); // killed mid-write
  addToManifest(out, entry("effect.b"));
  const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(m.assets), ["effect.b"]);
});
