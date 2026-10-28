// When a take starts recording: once the page shows what's in the viewport, not when every off-screen video has
// loaded (bot18's load event waits 8 s for preloaded clips nobody sees in the first frame).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import sharp from "sharp";

const REC = join(import.meta.dirname, "..", "bin", "autocap.mjs");
const red = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ff0000" } }).png().toBuffer();

async function serve(page, slow) {
  const finished = {};
  const server = createServer((req, res) => {
    const delay = slow[req.url];
    if (req.url === "/") return res.setHeader("content-type", "text/html"), res.end(page);
    setTimeout(() => { res.setHeader("content-type", "image/png"); res.end(red); finished[req.url] = Date.now(); }, delay ?? 0);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, finished, url: `http://127.0.0.1:${server.address().port}/` };
}

function check(url) {
  const dir = mkdtempSync(join(tmpdir(), "rec-ready-"));
  writeFileSync(join(dir, "rec.config.mjs"), `export default { url: ${JSON.stringify(url)}, out: "assets", viewport: { width: 800, height: 600, dpr: 1 }, shots: [{ id: "page.open", title: "t", steps: [{ wait: 100 }] }] };`);
  return new Promise((r) => execFile(process.execPath, [REC, "check", "page.open", "--json"], { cwd: dir, timeout: 120000 }, (e, stdout, stderr) => r({ dir, code: e?.code ?? 0, stdout, stderr, at: Date.now() })));
}

test("a resource far below the fold doesn't hold up the take", async () => {
  const { server, finished, url } = await serve(`<body style="margin:0"><h1>Hello</h1><img src="/slow-hidden.png" style="position:absolute;top:5000px"></body>`, { "/slow-hidden.png": 15000 });
  const r = await check(url);
  server.close();
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!finished["/slow-hidden.png"] || r.at < finished["/slow-hidden.png"], "check waited for an image nobody could see");
});

test("an image in the viewport is in the first frame even when it loads slowly", async () => {
  const { server, url } = await serve(`<body style="margin:0"><img src="/slow-visible.png" style="position:absolute;left:0;top:0"></body>`, { "/slow-visible.png": 6000 });
  const r = await check(url);
  server.close();
  assert.equal(r.code, 0, r.stderr);
  const { data } = await sharp(join(r.dir, "assets", ".debug", "page.open.png")).raw().toBuffer({ resolveWithObject: true });
  // 6 s is longer than everything check does after the page opens, so without waiting the image would be missing
  assert.deepEqual([...data.subarray(0, 3)], [255, 0, 0], "the visible image had not loaded when recording started");
});
