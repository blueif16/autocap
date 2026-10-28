// Screenshots of a page that has scrolled. CDP's clip is in document coordinates: a clip fixed at (0, 0) captured the
// unrendered region above the viewport once the window scrolled (bot18's navigator: blank frames from 1.25 s on).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { launch, recorder, snapshot } from "../src/browser.mjs";

let s;
before(async () => {
  s = await launch({ width: 400, height: 300, dpr: 1 });
  const f = join(mkdtempSync(join(tmpdir(), "rec-scroll-")), "p.html");
  const rows = Array.from({ length: 60 }, (_, i) => `<div style="height:50px;background:${i % 2 ? "#222" : "#ddd"};color:#f00">row ${i}</div>`).join("");
  writeFileSync(f, `<!doctype html><body style="margin:0">${rows}</body>`);
  await s.page.goto(pathToFileURL(f).href);
  await s.page.evaluate(() => window.scrollTo(0, 1500));
});
after(() => s.browser.close());

/** Share of pixels that differ from the median: 0 for a blank frame, ~50% for the striped rows. */
async function detail(buf) {
  const { data } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  const sorted = [...data].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  return data.filter((v) => Math.abs(v - med) > 8).length / data.length;
}

test("the recorder films the scrolled viewport, not the top of the document", async () => {
  const rec = recorder(s.cdp, { dir: join(mkdtempSync(join(tmpdir(), "rec-scroll-f-")), "f"), clip: { x: 0, y: 0, width: 400, height: 300 }, scale: 1 });
  await new Promise((r) => setTimeout(r, 300));
  const frames = await rec.stop();
  assert.ok((await detail(readFileSync(frames.at(-1).file))) > 0.2, "the frame is blank");
});

test("a snapshot shows the scrolled viewport", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "rec-scroll-s-")), "s.png");
  await snapshot(s.cdp, f, { x: 0, y: 0, width: 400, height: 300 });
  assert.ok((await detail(readFileSync(f))) > 0.2, "the snapshot is blank");
});
