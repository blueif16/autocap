// End to end on a plain HTML page (no agent-teams anywhere): proves the core records any web app.
// Needs Google Chrome and ffmpeg on this machine; takes ~30 s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REC = join(import.meta.dirname, "..", "bin", "autocap.mjs");

const PAGE = `<!doctype html><html><body style="margin:0;font:16px system-ui;background:#f4f4f6">
<button id="go" style="position:absolute;left:600px;top:400px;padding:12px 20px">Go</button>
<div id="card" style="position:absolute;left:520px;top:480px;width:300px;height:120px;background:#fff;border-radius:12px;display:none">Done</div>
<script>go.onclick = () => { card.style.display = "block"; card.animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 300 }); };</script>
</body></html>`;

function app() {
  const dir = mkdtempSync(join(tmpdir(), "rec-take-"));
  writeFileSync(join(dir, "page.html"), PAGE);
  writeFileSync(join(dir, "rec.config.mjs"), `export default {
  url: ${JSON.stringify(pathToFileURL(join(dir, "page.html")).href)},
  out: "assets",
  viewport: { width: 1280, height: 800, dpr: 1 },
  shots: [
    { id: "card.pop", feature: "cards", title: "Card pops in", demonstrates: "Clicking Go shows the card",
      async act({ page, d }) {
        await d.click(page.locator("#go"), { what: "press Go" });
        await d.wait(400);
        d.mark("card shown", await d.box(page.locator("#card")));
        await d.wait(400);
      } },
    { id: "card.missing", feature: "cards", title: "Clicks a button that does not exist", demonstrates: "x",
      async act({ page, d }) { await d.click(page.locator("#nope")); } },
    { id: "card.boom", feature: "cards", title: "Fails mid-recording", demonstrates: "x",
      async act({ d }) { await d.wait(200); throw new Error("boom"); } },
  ],
};`);
  return dir;
}

const run = (cwd, ...args) => spawnSync(process.execPath, [REC, ...args], { cwd, encoding: "utf8", env: { ...process.env, REC_RATE: "0.2" }, timeout: 180000 });

test("take records a shot of a plain page into clips, a timeline and a manifest entry", () => {
  const dir = app();
  const r = run(dir, "take", "card.pop");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = join(dir, "assets", "effects", "card.pop");
  for (const f of ["full.mp4", "focus.mp4", "slowmo.mp4", "smart.mp4", "poster.png"]) assert.ok(statSync(join(out, f)).size > 1000, `${f} is empty`);
  const tl = JSON.parse(readFileSync(join(out, "timeline.json"), "utf8"));
  assert.deepEqual(tl.viewport, { w: 1280, h: 800, dpr: 1 });
  assert.deepEqual(tl.marks.map((m) => m.what), ["press Go", "card shown"]);
  assert.deepEqual(tl.marks[1].box, { x: 520, y: 480, w: 300, h: 120 });
  const manifest = JSON.parse(readFileSync(join(dir, "assets", "manifest.json"), "utf8"));
  assert.equal(manifest.assets["effect.card.pop"].feature, "cards");
  assert.equal(manifest.assets["effect.card.pop"].files.smart, "effects/card.pop/smart.mp4");
});

test("check fails a shot whose target is missing, exits 1 and leaves no clips", () => {
  const dir = app();
  const r = run(dir, "check", "card.missing");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /card\.missing/);
  assert.ok(!existsSync(join(dir, "assets", "effects", "card.missing")));
});

test("a take that fails mid-recording leaves no frames on disk", () => {
  const dir = app();
  const r = run(dir, "take", "card.boom");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /boom/);
  assert.ok(!existsSync(join(dir, "assets", ".frames", "card.boom")), "frames left behind");
});
