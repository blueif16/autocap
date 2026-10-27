// What a fresh agent runs first: guide (the vocabulary), init (a starting config), skill (its instructions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateSteps } from "../src/steps.mjs";
import { VERBS, TOPICS } from "../src/vocab.mjs";

const REC = join(import.meta.dirname, "..", "bin", "autocap.mjs");
const rec = (cwd, ...args) => spawnSync(process.execPath, [REC, ...args], { cwd, encoding: "utf8" });
const tmp = () => mkdtempSync(join(tmpdir(), "rec-onboard-"));
const SAMPLE = { goto: "/", click: "#a", hover: "#a", type: "x", key: "Enter", scroll: 100, drag: "#a", select: "#s", wait: 10, see: "#a", emit: "/s", run: () => {} };
const NEEDS = { drag: { to: "#b" }, select: { value: "v" } };

test("guide --json lists the verbs, and every listed verb is one validation accepts", () => {
  const g = JSON.parse(rec(tmp(), "guide", "--json").stdout);
  assert.ok(g.verbs.length >= 12);
  for (const v of g.verbs) validateSteps([{ [v.verb]: SAMPLE[v.verb], ...NEEDS[v.verb] }]);
  assert.throws(() => validateSteps([{ tap: "#a" }]));
});

test("guide --json lists the step camera modes, and every one is accepted on a step", () => {
  const g = JSON.parse(rec(tmp(), "guide", "--json").stdout);
  assert.ok(g.cam.step.includes("follow") && g.cam.step.includes("wide"));
  for (const m of g.cam.step) validateSteps([{ click: "#a", cam: m }]);
});

test("guide all prints the loop and an example shot for humans", () => {
  const r = rec(tmp(), "guide", "all");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /understand the codebase/i);
  assert.match(r.stdout, /rec take/);
  assert.match(r.stdout, /steps: \[/);
});

test("bare guide is a short index of its topics, not the whole vocabulary", () => {
  const r = rec(tmp(), "guide");
  assert.equal(r.status, 0);
  for (const t of Object.keys(TOPICS)) assert.match(r.stdout, new RegExp(`\\b${t}\\b`), t);
  assert.doesNotMatch(r.stdout, /steps: \[/);
  assert.ok(r.stdout.length < 800, `${r.stdout.length} chars`);
});

test("guide <topic> prints only that topic", () => {
  const targets = rec(tmp(), "guide", "targets").stdout;
  assert.match(targets, /role=/);
  assert.doesNotMatch(targets, /understand the codebase/i);
  assert.doesNotMatch(targets, /goto:/);
});

test("guide cam includes the zoom limit and padding a shot can set", () => {
  const cam = rec(tmp(), "guide", "cam").stdout;
  assert.match(cam, /\bmax\b.*2\.4/);
  assert.match(cam, /\bpad\b/);
});

test("guide all is every topic, in order", () => {
  const all = rec(tmp(), "guide", "all").stdout;
  let at = -1;
  for (const t of Object.keys(TOPICS)) {
    const slice = rec(tmp(), "guide", t).stdout.trim();
    const i = all.indexOf(slice);
    assert.ok(i > at, `${t} is missing from guide all, or out of order`);
    at = i;
  }
});

test("an unknown guide topic exits 2 and lists the topics", () => {
  const r = rec(tmp(), "guide", "verbs-please");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /steps/);
});

test("the skill names every verb, so a first shot can be drafted from it", () => {
  const md = readFileSync(join(import.meta.dirname, "..", "skill", "SKILL.md"), "utf8");
  for (const v of Object.keys(VERBS)) assert.match(md, new RegExp("`" + v + "`"), v);
});

test("init writes a config and a first shot that rec ls lists", () => {
  const dir = tmp();
  const r = rec(dir, "init", "http://localhost:5173");
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, "rec.config.mjs"), "utf8"), /http:\/\/localhost:5173/);
  const ls = JSON.parse(rec(dir, "ls", "--json").stdout);
  assert.deepEqual(ls.shots.map((s) => s.format), ["steps"]);
});

test("init never overwrites an existing config", () => {
  const dir = tmp();
  rec(dir, "init");
  const r = rec(dir, "init", "http://other");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /already exists/);
  assert.doesNotMatch(readFileSync(join(dir, "rec.config.mjs"), "utf8"), /http:\/\/other/);
});

test("skill --install --dir writes SKILL.md with its name and the loop", () => {
  const dir = tmp();
  const r = rec(tmp(), "skill", "--install", "--dir", dir);
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(join(dir, "autocap", "SKILL.md"), "utf8");
  assert.match(md, /^---\nname: autocap\n/);
  assert.match(md, /rec look/);
  assert.ok(!existsSync(join(dir, "SKILL.md")), "installed in its own folder");
});
