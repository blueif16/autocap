// Step verbs against a fixture page at full speed (no recording): each verb does what the vocabulary says and
// records the event the camera and manifest rely on.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "../src/browser.mjs";
import { installStage } from "../src/stage.mjs";
import { Director } from "../src/director.mjs";
import { runSteps, validateSteps } from "../src/steps.mjs";
import { toLocator } from "../src/target.mjs";

const URL_ = pathToFileURL(join(import.meta.dirname, "fixtures", "steps.html")).href;
let s;
before(async () => {
  s = await launch({ width: 1280, height: 800, dpr: 1 });
  await installStage(s.page, { streams: ["/stream"] });
  s.page.setDefaultTimeout(2000);
});
after(() => s.browser.close());

async function go(steps) {
  await s.page.goto(URL_);
  const d = new Director(s.page, 1, { x: 640, y: 400 });
  const t0 = performance.now();
  d.start({ now: () => performance.now() - t0 });
  await runSteps(steps, { page: s.page, d, cfg: { url: URL_ } });
  return d;
}
const text = (sel) => s.page.locator(sel).textContent();

test("click glides to the target, clicks it and records its box", async () => {
  const d = await go([{ click: "#inc" }]);
  assert.equal(await text("#count"), "1");
  assert.deepEqual(d.events.map((e) => [e.verb, e.box]), [["click", { x: 100, y: 100, w: 100, h: 40 }]]);
  assert.ok(d.cursor.some((c) => c.down), "the press is in the cursor track");
  assert.deepEqual(d.marks, []);
});

test("beat names the moment with the step's box and time", async () => {
  const d = await go([{ click: "#inc", beat: "added one" }]);
  assert.deepEqual(d.marks, [{ atMs: d.events[0].atMs, what: "added one", box: d.events[0].box }]);
});

test("type into a labelled input fills it and frames the input", async () => {
  const d = await go([{ type: "Ada", into: "label=Name" }]);
  assert.equal(await s.page.locator("#name").inputValue(), "Ada");
  assert.deepEqual(d.events.at(-1).box, { x: 100, y: 200, w: 200, h: 30 });
});

test("key presses on the focused element", async () => {
  await go([{ type: "cats", into: "placeholder=Search" }, { key: "Enter" }]);
  assert.equal(await text("#submitted"), "cats");
});

test("hover fires hover handlers without clicking", async () => {
  await go([{ hover: "text=Hover me" }]);
  assert.equal(await text("#hovd"), "hovered");
  assert.equal(await text("#count"), "0");
});

test("scroll brings a far target to the middle of the view", async () => {
  const d = await go([{ scroll: "text=Far below" }]);
  const box = d.events[0].box;
  assert.ok(box.y > 200 && box.y + box.h < 600, `target at y=${box.y} after scrolling`);
});

test("scroll by pixels moves the page", async () => {
  await go([{ scroll: 300 }]);
  const y = await s.page.evaluate(() => scrollY);
  assert.ok(Math.abs(y - 300) <= 5, `scrollY ${y}`);
});

test("select chooses the value", async () => {
  await go([{ select: "#sel", value: "two" }]);
  assert.equal(await s.page.locator("#sel").inputValue(), "two");
});

test("drag drops the source on the to target", async () => {
  await go([{ drag: "#src", to: "#dst" }]);
  assert.equal(await text("#dropped"), "yes");
});

test("see waits for an element to appear and frames it", async () => {
  const d = await go([{ see: "#late", beat: "card arrives" }]);
  assert.ok(d.events[0].atMs >= 350, `seen at ${d.events[0].atMs} ms, it appears at 400`);
  assert.deepEqual(d.events[0].box, { x: 800, y: 300, w: 150, h: 60 });
  assert.equal(d.marks[0].what, "card arrives");
});

test("emit fires an event on a staged stream", async () => {
  await go([{ emit: "/stream", event: "note", data: { text: "hi" } }, { wait: 50 }]);
  assert.equal(await text("#live"), "hi");
});

test("run executes custom code with the page", async () => {
  await go([{ run: ({ page }) => page.evaluate(() => (document.title = "ran")) }]);
  assert.equal(await s.page.title(), "ran");
});

test("goto loads a page relative to the config url", async () => {
  await go([{ goto: "page2.html" }]);
  assert.equal(await text("h1"), "Second page");
});

test("camera options travel with the step event", async () => {
  const d = await go([{ click: "#inc", cam: "wide" }, { click: "#inc", zoom: 2, say: "Twice" }]);
  assert.equal(d.events[0].cam, "wide");
  assert.equal(d.events[1].zoom, 2);
  assert.equal(d.events[1].say, "Twice");
});

test("an optional missing target is skipped and the shot goes on", async () => {
  const d = await go([{ click: "#nope", optional: true }, { click: "#inc" }]);
  assert.equal(await text("#count"), "1");
  assert.equal(d.events[0].skipped, true);
});

test("a missing target fails with the step index and verb", async () => {
  await assert.rejects(go([{ wait: 10 }, { click: "#nope" }]), (e) => e.step?.step === 1 && e.step.verb === "click" && e.step.target === "#nope");
});

test("an ambiguous target fails with a hint to pick one", async () => {
  await assert.rejects(go([{ click: "text=Dup" }]), (e) => /nth=/.test(e.message));
});

test("validation rejects an unknown verb and lists the valid ones", () => {
  assert.throws(() => validateSteps([{ tap: "#a" }]), /step 0: unknown verb "tap".*goto, click/);
});

test("validation rejects a step with two verbs", () => {
  assert.throws(() => validateSteps([{ click: "#a", hover: "#b" }]), /step 0: one verb per step/);
});

test("validation rejects an option the verb doesn't take", () => {
  assert.throws(() => validateSteps([{ click: "#a", into: "#b" }]), /step 0: click has no option "into"/);
});

test("validation rejects an unknown camera mode and lists the valid ones", () => {
  assert.throws(() => validateSteps([{ click: "#a", cam: "zoomy" }]), /step 0: cam "zoomy".*wide, zoom/);
});

test("validation accepts every verb with its documented options", () => {
  validateSteps([
    { goto: "/" }, { click: "#a", button: "right" }, { hover: "#a" }, { type: "x", into: "#a", cps: 20, clear: true }, { key: "Enter" },
    { scroll: 200, in: "#list" }, { drag: "#a", to: "#b" }, { select: "#s", value: "v" }, { wait: 100 }, { see: "#a", timeout: 3000 },
    { emit: "/s", event: "e", data: {} }, { run: () => {} }, { click: "#a", beat: "b", cam: "follow", say: "x", ms: 300, optional: true, region: { x: 0, y: 0, w: 10, h: 10 } },
  ]);
});

test("each unique target suggested for an ambiguous one resolves to exactly one element", async () => {
  await s.page.setContent(`<h1>Argon wins</h1><button>Argon</button><span title="x">Argon</span><div data-testid="card">Argon card</div><a href="#">More Argon</a><label>Argon <input></label>`);
  const d = new Director(s.page, 1, { x: 640, y: 400 });
  const t0 = performance.now();
  d.start({ now: () => performance.now() - t0 });
  const e = await runSteps([{ click: "text=Argon" }], { page: s.page, d, cfg: { url: URL_ } }).then(() => null, (e) => e);
  const suggested = e?.message.match(/unique targets: (.*?)( …)?$/)?.[1].split(" · ") ?? [];
  assert.ok(suggested.length >= 3, e?.message);
  for (const t of suggested) assert.equal(await toLocator(s.page, t).count(), 1, t);
});
