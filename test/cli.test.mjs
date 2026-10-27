// The rec CLI against a throwaway app folder: what an agent sees when it lists shots or points rec at the wrong place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REC = join(import.meta.dirname, "..", "bin", "rec.mjs");
const rec = (cwd, ...args) => spawnSync(process.execPath, [REC, ...args], { cwd, encoding: "utf8" });

function app(config) {
  const dir = mkdtempSync(join(tmpdir(), "rec-cli-"));
  writeFileSync(join(dir, "rec.config.mjs"), config);
  return dir;
}

const TWO_SHOTS = `export default {
  url: "http://localhost:1",
  shots: [
    { id: "menu.open", feature: "menus", title: "Open the menu", demonstrates: "x", async act() {} },
    { id: "menu.close", feature: "menus", title: "Close the menu", demonstrates: "x", async act() {} },
  ],
};`;

test("ls prints every shot id with its title", () => {
  const r = rec(app(TWO_SHOTS), "ls");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /menu\.open\s+menus\s+Open the menu/);
  assert.match(r.stdout, /menu\.close\s+menus\s+Close the menu/);
});

test("without a rec.config.mjs, rec exits 2 and names the file it looked for", () => {
  const r = rec(mkdtempSync(join(tmpdir(), "rec-empty-")), "ls");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /rec\.config\.mjs/);
});

test("two shots with the same id are rejected with exit 3", () => {
  const r = rec(app(TWO_SHOTS.replace('"menu.close"', '"menu.open"')), "ls");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /duplicate shot id menu\.open/);
});

test("a shot without act is rejected with exit 3 naming the shot", () => {
  const r = rec(app(TWO_SHOTS.replace(", async act() {} },\n  ],", " },\n  ],")), "ls");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /menu\.close.*act/);
});

test("take with a prefix that matches no shot exits 1 and says so", () => {
  const r = rec(app(TWO_SHOTS), "take", "nothing.here");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no shot matches nothing\.here/);
});
