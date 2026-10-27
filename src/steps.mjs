// Runs a shot's steps (vocabulary in vocab.mjs). Every step logs an event { i, verb, atMs, box?, cam?, zoom?,
// region?, say?, beat? } on the Director: the camera frames boxes, beats become manifest moments, say becomes captions.
import { VERBS, COMMON, CAM, verbOf } from "./vocab.mjs";
import { toLocator } from "./target.mjs";
import { rule, emit } from "./stage.mjs";

/** A step failed: `step` = { step, verb, target? } so an agent knows exactly which line of the shot to fix. */
export class StepError extends Error {
  constructor(i, verb, target, cause) {
    const first = String(cause?.message ?? cause).split("\n")[0];
    super(`step ${i} (${verb}${typeof target === "string" ? ` ${target}` : ""}): ${first}${hint(String(cause?.message ?? ""))}`);
    this.step = { step: i, verb, ...(typeof target === "string" ? { target } : {}) };
  }
}

function hint(msg) {
  if (/strict mode violation/.test(msg)) return ` · the target matches several elements: make it more specific, or append " >> nth=0"`;
  if (/Timeout .*exceeded/.test(msg)) return " · not found or not visible: check the target against the page, or add optional: true if it may be absent";
  return "";
}

const OPTIONS = (verb) => [...VERBS[verb].options, ...Object.keys(COMMON)];
const VALUE = { wait: "number", scroll: "string|number", run: "function" };

/** Throws a message naming the step and the valid choices for the first problem found. */
export function validateSteps(steps, where = "") {
  if (!Array.isArray(steps)) throw new Error(`${where}steps must be an array`);
  steps.forEach((st, i) => {
    const at = `${where}step ${i}`;
    if (!st || typeof st !== "object" || Array.isArray(st)) throw new Error(`${at}: a step is an object like { click: "role=button[name=\\"Go\\"]" }`);
    const verbs = verbOf(st);
    if (verbs.length > 1) throw new Error(`${at}: one verb per step, found ${verbs.join(" and ")}`);
    if (!verbs.length) {
      const k = Object.keys(st).find((k) => !(k in COMMON));
      throw new Error(`${at}: ${k ? `unknown verb "${k}"` : "no verb"} (valid: ${Object.keys(VERBS).join(", ")})`);
    }
    const verb = verbs[0], v = st[verb];
    for (const k of Object.keys(st)) if (k !== verb && !OPTIONS(verb).includes(k)) throw new Error(`${at}: ${verb} has no option "${k}" (it takes: ${OPTIONS(verb).join(", ")})`);
    const want = VALUE[verb] ?? "string";
    if (!want.split("|").includes(typeof v) || (typeof v === "string" && !v.trim())) throw new Error(`${at}: ${verb} takes a ${want.replace("|", " or ")} (${VERBS[verb].value}), got ${JSON.stringify(v)}`);
    if (st.cam !== undefined && !(st.cam in CAM.step)) throw new Error(`${at}: cam "${st.cam}" is not a camera mode (valid: ${Object.keys(CAM.step).join(", ")})`);
    if (st.zoom !== undefined && !(typeof st.zoom === "number" && st.zoom >= 1)) throw new Error(`${at}: zoom is a level ≥ 1, e.g. 1.8`);
    if (st.region !== undefined && !["x", "y", "w", "h"].every((k) => typeof st.region?.[k] === "number")) throw new Error(`${at}: region is { x, y, w, h } in CSS px`);
    if ((verb === "drag" && !st.to) || (verb === "select" && st.value === undefined)) throw new Error(`${at}: ${verb} needs ${verb === "drag" ? "to" : "value"}`);
  });
}

export async function runSteps(steps, ctx) {
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const [verb] = verbOf(st);
    try {
      await DO[verb](st[verb], st, ctx, i);
    } catch (e) {
      throw e instanceof StepError ? e : new StepError(i, verb, st[verb], e);
    }
  }
}

function record({ d }, i, verb, st, box) {
  const atMs = Math.round(d.clock());
  const e = { i, verb, atMs, ...(box ? { box } : {}) };
  for (const k of ["cam", "zoom", "region", "say", "beat"]) if (st[k] !== undefined) e[k] = st[k];
  d.events.push(e);
  if (st.beat) d.mark(st.beat, st.region ?? box, atMs);
}

/** The target, visible and on screen (scrolled into view smoothly if it isn't), or null when optional and absent. */
async function find(ctx, target, st) {
  const loc = toLocator(ctx.page, target);
  if (st.optional) {
    try {
      await loc.waitFor({ state: "visible", timeout: 1500 / ctx.d.rate });
    } catch {
      return null;
    }
  } else await loc.waitFor({ state: "visible" });
  const b = await loc.boundingBox();
  const vp = ctx.page.viewportSize();
  if (b && (b.y < 0 || b.x < 0 || b.y + b.height > vp.height || b.x + b.width > vp.width)) await glide(ctx, loc, {});
  return loc;
}

// Smooth scroll driven by requestAnimationFrame, so it runs on the page's slowed clock and records smoothly
// (native smooth scrolling ignores the dilation and would jump in the footage).
const GLIDE = (el, { by, ms }) =>
  new Promise((done) => {
    const scrollable = (n) => n && n !== document.body && n !== document.documentElement && /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight;
    let box = el && by === undefined ? el.parentElement : el;
    if (by === undefined) while (box && !scrollable(box)) box = box.parentElement;
    else if (box && !scrollable(box)) box = null;
    const root = box ?? document.scrollingElement;
    let delta = by;
    if (delta === undefined) {
      const r = el.getBoundingClientRect(), c = box ? box.getBoundingClientRect() : { top: 0, height: innerHeight };
      delta = r.top + r.height / 2 - (c.top + c.height / 2);
    }
    const from = root.scrollTop, to = Math.max(0, Math.min(from + delta, root.scrollHeight - root.clientHeight));
    const t0 = performance.now(), ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      root.scrollTop = from + (to - from) * ease(t);
      t < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  });

const glide = (ctx, loc, { by, ms = 650 }) => (loc ?? ctx.page.locator("html")).evaluate(GLIDE, { by, ms });

const box = (d, loc) => d.box(loc);

const DO = {
  async goto(v, st, ctx, i) {
    await ctx.page.goto(new URL(v, ctx.cfg.url).href, { waitUntil: "load" });
    await ctx.page.mouse.move(ctx.d.pos.x, ctx.d.pos.y); // the staged cursor reappears on the new page
    record(ctx, i, "goto", st, null);
  },
  async click(v, st, ctx, i) {
    const loc = await find(ctx, v, st);
    if (!loc) return skip(ctx, i, "click");
    const b = await ctx.d.hover(loc, { ms: st.ms ?? 450 });
    await ctx.d.wait(140);
    record(ctx, i, "click", st, b);
    await ctx.d.press({ button: st.button, double: st.double });
  },
  async hover(v, st, ctx, i) {
    const loc = await find(ctx, v, st);
    if (!loc) return skip(ctx, i, "hover");
    record(ctx, i, "hover", st, await ctx.d.hover(loc, { ms: st.ms ?? 450 }));
  },
  async type(v, st, ctx, i) {
    const { page, d } = ctx;
    let b = null;
    if (st.into) {
      const loc = await find(ctx, st.into, st);
      if (!loc) return skip(ctx, i, "type");
      b = await d.hover(loc, { ms: st.ms ?? 450 });
      await d.wait(120);
      await d.press({});
    } else b = await page.evaluate(() => { const r = document.activeElement?.getBoundingClientRect(); return r && r.width ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; });
    if (st.clear) {
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
    }
    record(ctx, i, "type", st, b);
    await page.keyboard.type(v, { delay: 1000 / (st.cps ?? 14) / d.rate });
  },
  async key(v, st, ctx, i) {
    record(ctx, i, "key", st, null);
    await ctx.page.keyboard.press(v);
  },
  async scroll(v, st, ctx, i) {
    if (typeof v === "number") {
      const inside = st.in ? await find(ctx, st.in, st) : null;
      await glide(ctx, inside, { by: v });
      return record(ctx, i, "scroll", st, inside ? await box(ctx.d, inside) : null);
    }
    const loc = toLocator(ctx.page, v);
    await loc.waitFor({ state: "attached" });
    await glide(ctx, loc, {});
    record(ctx, i, "scroll", st, await box(ctx.d, loc));
  },
  async drag(v, st, ctx, i) {
    const { page, d } = ctx;
    const from = await find(ctx, v, st);
    if (!from) return skip(ctx, i, "drag");
    const a = await d.hover(from, { ms: st.ms ?? 450 });
    await d.wait(120);
    d.cursor.push({ atMs: Math.round(d.clock()), x: Math.round(d.pos.x), y: Math.round(d.pos.y), down: true });
    await page.mouse.down();
    const to = await find(ctx, st.to, {});
    const b = await box(d, to);
    await d.move(b.x + b.w / 2, b.y + b.h / 2, st.ms ?? 700);
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    record(ctx, i, "drag", st, { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y });
    await page.mouse.up();
  },
  async select(v, st, ctx, i) {
    const loc = await find(ctx, v, st);
    if (!loc) return skip(ctx, i, "select");
    const b = await ctx.d.hover(loc, { ms: st.ms ?? 450 });
    await ctx.d.wait(140);
    record(ctx, i, "select", st, b);
    await loc.selectOption(String(st.value));
  },
  async wait(v, st, ctx, i) {
    record(ctx, i, "wait", st, null);
    await ctx.d.wait(v);
  },
  async see(v, st, ctx, i) {
    const loc = toLocator(ctx.page, v);
    await loc.waitFor({ state: "visible", ...(st.timeout ? { timeout: st.timeout / ctx.d.rate } : {}) });
    const seen = await find(ctx, v, {});
    record(ctx, i, "see", st, await box(ctx.d, seen));
  },
  async emit(v, st, ctx, i) {
    record(ctx, i, "emit", st, null);
    await emit(ctx.page, v, st.event ?? "message", st.data ?? {});
  },
  async run(v, st, ctx, i) {
    record(ctx, i, "run", st, null);
    await v({ page: ctx.page, d: ctx.d, rule: (r) => rule(ctx.page, r), emit: (u, t, data) => emit(ctx.page, u, t, data) });
  },
};

function skip({ d }, i, verb) {
  d.events.push({ i, verb, atMs: Math.round(d.clock()), skipped: true });
}
