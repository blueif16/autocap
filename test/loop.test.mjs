// The whole agent loop on a plain page with a steps shot: take → cut variants → look. Needs Chrome + ffmpeg; ~1-2 min.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REC = join(import.meta.dirname, "..", "bin", "rec.mjs");
const run = (cwd, ...args) => spawnSync(process.execPath, [REC, ...args], { cwd, encoding: "utf8", env: { ...process.env, REC_RATE: "0.25" }, timeout: 300000 });
const probe = (f) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).trim();

const PAGE = `<!doctype html><html><head><title>Notes</title></head><body style="margin:0;font:16px system-ui;background:#f6f6f8">
<input id="t" placeholder="New note" style="position:absolute;left:80px;top:80px;width:300px;height:36px;box-sizing:border-box">
<button style="position:absolute;left:400px;top:80px;width:90px;height:36px">Add</button>
<ul id="list" style="position:absolute;left:80px;top:160px;margin:0;padding:0;list-style:none"></ul>
<script>
document.querySelector("button").onclick = () => setTimeout(() => {
  const li = document.createElement("li"); li.className = "note"; li.textContent = t.value;
  li.style.cssText = "width:400px;height:48px;background:#fff;border-radius:10px;margin-bottom:8px";
  list.appendChild(li); li.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1 }], { duration: 300 });
}, 300);
</script></body></html>`;

function app() {
  const dir = mkdtempSync(join(tmpdir(), "rec-loop-"));
  writeFileSync(join(dir, "index.html"), PAGE);
  writeFileSync(join(dir, "rec.config.mjs"), `export default {
  url: ${JSON.stringify(pathToFileURL(join(dir, "index.html")).href)},
  out: "assets",
  viewport: { width: 1280, height: 800, dpr: 1 },
  stage: { cursor: true },
  shots: [{
    id: "notes.add", title: "Add a note",
    steps: [
      { type: "Buy milk", into: "placeholder=New note", say: "Type a note" },
      { click: 'role=button[name="Add"]', beat: "add", say: "Add it" },
      { see: "css=.note", beat: "note lands" },
      { wait: 400, cam: "wide" },
    ],
  }],
};`);
  return dir;
}

test("a steps shot records, re-cuts as vertical and gif with another camera, and passes look", () => {
  const dir = app();
  const take = run(dir, "take", "notes.add", "--json");
  assert.equal(take.status, 0, take.stderr);
  assert.equal(JSON.parse(take.stdout).results[0].ok, true);

  const out = join(dir, "assets", "effects", "notes.add");
  const tl = JSON.parse(readFileSync(join(out, "timeline.json"), "utf8"));
  assert.equal(tl.version, 2);
  assert.deepEqual(tl.events.map((e) => e.verb), ["type", "click", "see", "wait"]);
  assert.deepEqual(tl.marks.map((m) => m.what), ["add", "note lands"]);
  assert.equal(probe(join(out, "smart.mp4")), "1920,1080");
  const srt = readFileSync(join(out, "captions.srt"), "utf8");
  assert.match(srt, /^1\n00:00:\d\d,\d{3} --> 00:00:\d\d,\d{3}\nType a note\n\n2\n.*\nAdd it\n/s);

  const cut = run(dir, "cut", "notes.add", "--as", "vertical,gif", "--cam", "off", "--json");
  assert.equal(cut.status, 0, cut.stderr);
  assert.equal(probe(join(out, "smart-9x16-off.mp4")), "1080,1920");
  assert.ok(existsSync(join(out, "smart-off.gif")));
  assert.equal(JSON.parse(readFileSync(join(out, "smart-9x16-off.cut.json"), "utf8")).cam.auto, "off");

  const look = run(dir, "look", "notes.add", "--json");
  assert.equal(look.status, 0, look.stderr);
  const report = JSON.parse(look.stdout);
  assert.deepEqual(report.moments.map((m) => [m.what, m.inFrame]), [["add", true], ["note lands", true]]);
});
