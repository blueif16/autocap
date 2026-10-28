// What a failing step tells the agent. The cause below is Playwright 1.60's own message for a target that matched
// six elements, captured from a real page: the error must hand back unique targets in autocap's syntax.
import { test } from "node:test";
import assert from "node:assert/strict";
import { StepError } from "../src/steps.mjs";

const STRICT = `locator.click: Error: strict mode violation: locator('text=Argon') resolved to 6 elements:
    1) <h1>Argon wins</h1> aka getByRole('heading', { name: 'Argon wins' })
    2) <button>Argon</button> aka getByRole('button', { name: 'Argon' })
    3) <span title="x">Argon</span> aka getByTitle('x')
    4) <div data-testid="card">Argon card</div> aka getByTestId('card')
    5) <title>Argon</title> aka locator('title')
    6) <a href="#">More Argon</a> aka getByRole('link', { name: 'More Argon' })

Call log:
  - waiting for locator('text=Argon')`;

test("a target that matches several elements comes back with unique targets to use instead", () => {
  const e = new StepError(1, "click", "text=Argon", new Error(STRICT));
  assert.match(e.message, /6 elements/);
  for (const t of ['role=heading[name="Argon wins"]', 'role=button[name="Argon"]', "title=x", "testid=card", "css=title"]) assert.ok(e.message.includes(t), `${t} in: ${e.message}`);
  assert.doesNotMatch(e.message, /getByRole|Call log/);
});

test("a step error stays on one line", () => {
  assert.doesNotMatch(new StepError(1, "click", "text=Argon", new Error(STRICT)).message, /\n/);
});

test("frame takes target or container, and anything else is rejected with the valid values", async () => {
  const { validateSteps } = await import("../src/steps.mjs");
  validateSteps([{ click: "#a", frame: "container" }, { see: "#b", frame: "target" }]);
  assert.throws(() => validateSteps([{ click: "#a", frame: "parent" }]), /frame "parent".*target, container/);
});
