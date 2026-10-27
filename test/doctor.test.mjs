// rec doctor through the real CLI in throwaway app folders: what an agent on a new machine is told.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REC = join(import.meta.dirname, "..", "bin", "rec.mjs");
const doctor = (cwd, ...args) => spawnSync(process.execPath, [REC, "doctor", "--json", ...args], { cwd, encoding: "utf8" });
const checks = (r) => Object.fromEntries(JSON.parse(r.stdout).checks.map((c) => [c.name, c]));

function app(url) {
  const dir = mkdtempSync(join(tmpdir(), "rec-doctor-"));
  writeFileSync(join(dir, "rec.config.mjs"), `export default { url: ${JSON.stringify(url)}, shots: [] };`);
  return dir;
}

test("no rec.config.mjs: config check fails and the fix says rec init", () => {
  const c = checks(doctor(mkdtempSync(join(tmpdir(), "rec-doctor-empty-"))));
  assert.equal(c.config.ok, false);
  assert.match(c.config.fix, /rec init/);
  assert.equal(c.app, undefined, "app is only checked when a config loaded");
});

test("a file:// url that exists passes the app check", () => {
  const dir = app("about:blank");
  const page = join(dir, "index.html");
  writeFileSync(page, "<html></html>");
  writeFileSync(join(dir, "rec.config.mjs"), `export default { url: ${JSON.stringify("file://" + page)}, shots: [] };`);
  const c = checks(doctor(dir));
  assert.equal(c.app.ok, true, c.app.detail);
  assert.equal(c.config.ok, true);
});

test("a closed port fails the app check with a fix, and the exit code is 2", () => {
  const r = doctor(app("http://127.0.0.1:9"));
  const c = checks(r);
  assert.equal(c.app.ok, false);
  assert.ok(c.app.fix);
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).ok, false);
});

test("--json is one parseable document and every check has name, ok, detail, fix", () => {
  const r = doctor(app("http://127.0.0.1:9"));
  const doc = JSON.parse(r.stdout);
  const names = doc.checks.map((c) => c.name);
  for (const n of ["node", "chrome", "ffmpeg", "renderer", "config", "app", "disk", "memory", "lock"]) assert.ok(names.includes(n), n);
  for (const c of doc.checks) {
    assert.equal(typeof c.name, "string");
    assert.equal(typeof c.ok, "boolean");
    assert.equal(typeof c.detail, "string");
    assert.ok("fix" in c);
    assert.equal(c.ok ? c.fix === null : typeof c.fix === "string", true, c.name);
  }
});

test("a lock held by a dead pid is stale and ok; one held by a live pid warns", () => {
  const dir = app("http://127.0.0.1:9");
  const lock = join(dir, "rec-assets", ".record.lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, "pid"), "999999");
  const stale = checks(doctor(dir)).lock;
  assert.equal(stale.ok, true);
  assert.match(stale.detail, /stale/);

  writeFileSync(join(lock, "pid"), String(process.pid));
  const live = checks(doctor(dir)).lock;
  assert.equal(live.ok, false);
  assert.equal(live.level, "warn");
  assert.match(live.detail, new RegExp(`pid ${process.pid}`));
});
