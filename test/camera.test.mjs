// The smart camera was extracted from agent-teams (scripts/promo/camera.mjs @ 7350d2a). These fixtures hold that
// camera's output for two real takes; the extracted planner must reproduce it frame for frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plan, path } from "../src/camera.mjs";

const fixture = (name) => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));

for (const id of ["reactions.go-ahead", "pm.plan-live"]) {
  test(`camera keys for ${id} match the agent-teams camera`, () => {
    assert.deepEqual(plan(fixture(`${id}.timeline.json`)), fixture(`${id}.camera.json`).keys);
  });

  test(`camera path for ${id} matches the agent-teams camera frame for frame`, () => {
    const want = fixture(`${id}.camera.json`).path;
    const got = path(fixture(`${id}.timeline.json`));
    assert.equal(got.length, want.length);
    for (let i = 0; i < want.length; i++)
      for (const k of ["cx", "cy", "w"]) assert.ok(Math.abs(got[i][k] - want[i][k]) <= 0.001, `frame ${i} ${k}: ${got[i][k]} vs ${want[i][k]}`);
  });
}
