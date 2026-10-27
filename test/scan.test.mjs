// rec scan builds a context sheet: a filmstrip per page, and `moving` tells an animated page from a static one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REC = join(import.meta.dirname, "..", "bin", "rec.mjs");

const STATIC = `<!doctype html><title>Static page</title><body style="margin:0;font:16px system-ui"><h1>Hello</h1><button>Go</button></body>`;
const ANIMATED = `<!doctype html><title>Animated page</title><body style="margin:0;font:16px system-ui"><h1>Hello</h1>
<div id="b" style="width:200px;height:80px;background:#e11d48"></div>
<script>b.animate([{ transform: "translateX(0)" }, { transform: "translateX(500px)" }], { duration: 1000, fill: "forwards" });</script></body>`;

function app(config = "") {
  const dir = mkdtempSync(join(tmpdir(), "rec-scan-"));
  writeFileSync(join(dir, "static.html"), STATIC);
  writeFileSync(join(dir, "animated.html"), ANIMATED);
  const url = pathToFileURL(join(dir, "static.html")).href;
  writeFileSync(join(dir, "rec.config.mjs"), `export default { url: ${JSON.stringify(url)}, out: "assets", viewport: { width: 640, height: 400 }, ${config} };`);
  return dir;
}

const scan = (dir, ...args) => spawnSync(process.execPath, [REC, "scan", ...args], { cwd: dir, encoding: "utf8", timeout: 120000 });
const height = (file) => readFileSync(file).readUInt32BE(20); // PNG IHDR: width at 16, height at 20

test("scan reports titles and which page moves, and the sheet grows with the page count", () => {
  const dir = app();
  const r2 = scan(dir, "--json", "static.html", "animated.html");
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const out = JSON.parse(r2.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.pages.map((p) => [p.path, p.title, p.moving]), [["static.html", "Static page", false], ["animated.html", "Animated page", true]]);
  for (const p of out.pages) {
    assert.deepEqual(p.frames.map((f) => f.ms), [0, 250, 500, 1000, 1500, 2500]);
    assert.ok(existsSync(p.still) && p.frames.every((f) => existsSync(f.file)));
  }
  assert.ok(existsSync(out.sheet));
  const h2 = height(out.sheet);
  const h1 = height(JSON.parse(scan(dir, "--json", "static.html").stdout).sheet);
  assert.ok(h2 > h1 * 1.5, `sheet height ${h2} should be about twice ${h1}`);
});

test("scan with no path uses cfg.pages and prints one line per page plus the sheet", () => {
  const dir = app(`pages: ["animated.html"]`);
  const r = scan(dir);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.match(lines[0], /^animated\.html {2}"Animated page" {2}moving {2}.*animated\.html\.png$/);
  assert.match(lines[1], /^sheet: .*sheet\.png$/);
});

test("scan exits 2 with a message when a page cannot be loaded", () => {
  const dir = app();
  const r = scan(dir, "http://127.0.0.1:9/");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /rec: cannot load .*127\.0\.0\.1/);
});
