// The page clock a take slows: timers armed before the slow-down, and reloads during a take, must follow it.
// Found on bot18: a 30 s auto-reload armed at load fired 30 real seconds later, mid-take (11 s of page time), and the
// reloaded page then ran at full speed: the blank frames of the dogfood nav.tour take.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch, setRate } from "../src/browser.mjs";

let s;
before(async () => { s = await launch({ width: 400, height: 300, dpr: 1 }); });
after(() => s.browser.close());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function page(script, body = "") {
  const f = join(mkdtempSync(join(tmpdir(), "rec-dilate-")), "p.html");
  writeFileSync(f, `<!doctype html><body>${body}<script>${script}</script></body>`);
  return pathToFileURL(f).href;
}
const pageNow = () => s.page.evaluate(() => performance.now());

test("a timer armed before the clock slows fires at its page time", async () => {
  await s.page.goto(page(`window.t0 = performance.now(); setTimeout(() => (window.fired = performance.now()), 1000);`));
  await setRate(s.page, s.cdp, 1);
  await sleep(200);
  await setRate(s.page, s.cdp, 0.25); // ~800 ms of page time left = ~3.2 s real
  await sleep(4500);
  const { t0, fired } = await s.page.evaluate(() => ({ t0: window.t0, fired: window.fired }));
  assert.ok(fired !== undefined, "never fired");
  assert.ok(Math.abs(fired - t0 - 1000) < 150, `fired after ${Math.round(fired - t0)} ms of page time, want 1000`);
});

test("an interval armed before the clock slows ticks at page-time speed", async () => {
  await s.page.goto(page(`window.n = 0; setInterval(() => window.n++, 100);`));
  await setRate(s.page, s.cdp, 1);
  await sleep(200);
  await setRate(s.page, s.cdp, 0.25);
  const [n0, p0] = [await s.page.evaluate(() => window.n), await pageNow()];
  await sleep(4000);
  const [n1, p1] = [await s.page.evaluate(() => window.n), await pageNow()];
  const want = (p1 - p0) / 100;
  assert.ok(Math.abs(n1 - n0 - want) <= 3, `${n1 - n0} ticks in ${Math.round(p1 - p0)} ms of page time, want ~${want.toFixed(0)}`);
});

test("a page that reloads during a take keeps the take's rate", async () => {
  await s.page.goto(page(``, `<div id="b" style="width:50px;height:50px;background:red;animation:m 100s linear"></div><style>@keyframes m{to{transform:translateX(300px)}}</style>`));
  await setRate(s.page, s.cdp, 0.25);
  await s.page.reload();
  const [p0, a0] = [await pageNow(), await s.page.evaluate(() => document.getAnimations()[0].currentTime)];
  await sleep(2000);
  const [p1, a1] = [await pageNow(), await s.page.evaluate(() => document.getAnimations()[0].currentTime)];
  assert.ok(p1 - p0 < 800, `page clock ran ${Math.round(p1 - p0)} ms in 2 s at 0.25x`);
  assert.ok(a1 - a0 < 800, `CSS animation ran ${Math.round(a1 - a0)} ms in 2 s at 0.25x`);
});
