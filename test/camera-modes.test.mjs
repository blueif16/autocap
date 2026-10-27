// Camera styles on synthetic timelines: each camera directive in the vocabulary changes the framing the way it says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { path, rect } from "../src/camera.mjs";

const W = 1440, H = 900;
const A = { x: 100, y: 120, w: 160, h: 40 }; // top left
const B = { x: 1180, y: 740, w: 160, h: 40 }; // bottom right
const tl = (events, cam = {}, more = {}) => ({ version: 2, viewport: { w: W, h: H, dpr: 2 }, durationMs: 4000, marks: [], cursor: [], events, cam, ...more });
const click = (atMs, box, more = {}) => ({ i: 0, verb: "click", atMs, box, ...more });
const at = (frames, ms) => frames[Math.min(frames.length - 1, Math.round((ms / 1000) * 60))];
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

test("auto off stays on the overview the whole time", () => {
  const p = path(tl([click(1000, A), click(2500, B)], { auto: "off" }));
  for (const c of p) assert.ok(Math.abs(c.w - W) < 1, `w ${c.w}`);
});

test("auto all punches in on each click target", () => {
  const p = path(tl([click(1000, A), click(2500, B)]));
  for (const [ms, box] of [[1000, A], [2500, B]]) {
    const c = at(p, ms);
    assert.ok(c.w < 800, `zoomed in at ${ms}: w ${c.w}`);
    assert.ok(inside(center(box), rect(c)), `target in frame at ${ms}`);
  }
});

test("cam wide on a step pulls back to the whole window", () => {
  const p = path(tl([click(800, A), click(2000, B, { cam: "wide" })], { end: "hold" }));
  assert.ok(at(p, 800).w < 800);
  assert.ok(Math.abs(at(p, 2600).w - W) < 10, `w ${at(p, 2600).w}`);
});

test("zoom sets the level: 2 shows half the window width", () => {
  const p = path(tl([click(1000, A, { zoom: 2 })], { end: "hold" }));
  assert.ok(Math.abs(at(p, 1600).w - W / 2) < 15, `w ${at(p, 1600).w}`);
});

test("cam hold keeps the framing and ignores the step's target", () => {
  const p = path(tl([click(800, A), click(2000, B, { cam: "hold" })], { end: "hold" }));
  const c = at(p, 2600);
  assert.ok(inside(center(A), rect(c)) && !inside(center(B), rect(c)), "still framed on A");
});

test("cam cut jumps to the target with no camera move", () => {
  const p = path(tl([click(800, A), click(2000, B, { cam: "cut" })], { end: "hold" }));
  assert.ok(inside(center(A), rect(at(p, 1980))), "on A just before the cut");
  const after = at(p, 2000 + 1000 / 60);
  assert.ok(inside(center(B), rect(after)), "on B one frame after the cut");
});

test("cam pan slides to the target at the current zoom level", () => {
  const p = path(tl([click(800, A, { zoom: 2 }), click(2000, B, { cam: "pan" })], { end: "hold" }));
  const c = at(p, 2600);
  assert.ok(Math.abs(c.w - W / 2) < 20, `kept the level: w ${c.w}`);
  assert.ok(inside(center(B), rect(c)), "now on B");
});

test("end wide eases back to the overview; end hold stays in", () => {
  assert.ok(Math.abs(path(tl([click(1000, A)])).at(-1).w - W) < 10, "default end is wide");
  assert.ok(path(tl([click(1000, A)], { end: "hold" })).at(-1).w < 800, "end hold stays in");
});

test("auto clicks ignores hover targets", () => {
  const hover = [{ i: 0, verb: "hover", atMs: 1000, box: A }];
  assert.ok(path(tl(hover, { auto: "all", end: "hold" })).some((c) => c.w < 800), "auto all frames the hover");
  for (const c of path(tl(hover, { auto: "clicks" }))) assert.ok(Math.abs(c.w - W) < 1);
});

test("auto beats frames only steps with a beat", () => {
  const p = path(tl([click(800, A), click(2200, B, { beat: "paid" })], { auto: "beats", end: "hold" }));
  assert.ok(Math.abs(at(p, 900).w - W) < 1, "the plain click stays wide");
  assert.ok(at(p, 2400).w < 800 && inside(center(B), rect(at(p, 2400))), "the beat is framed");
});

test("region frames the given area instead of the target", () => {
  const p = path(tl([click(1000, B, { region: { x: 0, y: 0, w: 720, h: 405 } })], { end: "hold" }));
  const c = at(p, 1600);
  assert.ok(Math.abs(c.cx - 360) < 10 && Math.abs(c.w - 720) < 15, `cx ${c.cx} w ${c.w}`);
});

test("vertical output keeps 9:16 inside the window and still frames the target", () => {
  const p = path(tl([click(1000, A), click(2500, B)]), { aspect: 9 / 16 });
  for (const c of p) {
    const r = rect(c, 9 / 16);
    assert.ok(Math.abs(r.w / r.h - 9 / 16) < 1e-6 && r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= W + 0.5 && r.y + r.h <= H + 0.5, JSON.stringify(r));
  }
  assert.ok(inside(center(B), rect(at(p, 2500), 9 / 16)));
});

test("cam follow keeps the moving cursor in frame", () => {
  const cursor = [];
  for (let t = 1000; t <= 2500; t += 20) cursor.push({ atMs: t, x: 200 + (t - 1000) * 0.7, y: 140 + (t - 1000) * 0.45 });
  const p = path(tl([click(900, A, { cam: "follow" })], { end: "hold" }, { cursor }));
  for (const q of cursor.filter((q) => q.atMs > 1300)) assert.ok(inside(q, rect(at(p, q.atMs))), `cursor ${q.x},${q.y} at ${q.atMs}`);
});

test("feel snappy reaches the target sooner than gentle", () => {
  const gap = (feel) => {
    const c = at(path(tl([click(1000, B)], { feel, end: "hold" })), 900);
    return Math.hypot(c.cx - center(B).x, c.cy - center(B).y);
  };
  assert.ok(gap("snappy") < gap("gentle"), `snappy ${gap("snappy")} vs gentle ${gap("gentle")}`);
});

test("in a vertical cut the overview centers on where the action is", () => {
  const left = { x: 80, y: 300, w: 200, h: 40 }, left2 = { x: 300, y: 500, w: 120, h: 40 };
  const p = path(tl([click(1000, left), click(2000, left2)], { auto: "off" }), { aspect: 9 / 16 });
  for (const [ms, b] of [[1000, left], [2000, left2]]) assert.ok(inside(center(b), rect(at(p, ms), 9 / 16)), `target at ${ms} ms is in the vertical overview`);
});
