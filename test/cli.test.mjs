// The rec CLI against a throwaway app folder: what an agent sees when it lists shots or points rec at the wrong place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REC = join(import.meta.dirname, "..", "bin", "autocap.mjs");
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

test("a steps shot with an unknown verb is rejected with exit 3 naming the shot and step", () => {
  const r = rec(app(`export default { url: "http://localhost:1", shots: [{ id: "a.b", title: "t", steps: [{ wait: 1 }, { tap: "#x" }] }] };`), "ls");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /shot a\.b step 1: unknown verb "tap"/);
});

test("a shot with both steps and act is rejected with exit 3", () => {
  const r = rec(app(`export default { url: "http://localhost:1", shots: [{ id: "a.b", title: "t", steps: [], async act() {} }] };`), "ls");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /a\.b.*steps or act/);
});

test("an unknown shot camera setting is rejected with exit 3 and the valid values", () => {
  const r = rec(app(`export default { url: "http://localhost:1", shots: [{ id: "a.b", title: "t", cam: { auto: "everything" }, steps: [] }] };`), "ls");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /cam\.auto "everything".*all, clicks, beats, off/);
});

test("shots can be a folder with one shot file each, and feature defaults to the id's group", () => {
  const dir = app(`export default { url: "http://localhost:1", shots: "rec/shots" };`);
  mkdirSync(join(dir, "rec", "shots"), { recursive: true });
  writeFileSync(join(dir, "rec", "shots", "open.mjs"), `export default { id: "menu.open", title: "Open the menu", steps: [{ click: "text=Menu" }] };`);
  writeFileSync(join(dir, "rec", "shots", "pair.mjs"), `export default [{ id: "cart.add", title: "Add", steps: [] }, { id: "cart.pay", title: "Pay", steps: [] }];`);
  const r = rec(dir, "ls", "--json");
  assert.equal(r.status, 0, r.stderr);
  const shots = JSON.parse(r.stdout).shots;
  assert.deepEqual(shots.map((s) => [s.id, s.feature]).sort(), [["cart.add", "cart"], ["cart.pay", "cart"], ["menu.open", "menu"]]);
});
