import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, CLEAN_CSS } from "../browser.mjs";
import { RecError } from "../config.mjs";
import { installStage } from "../stage.mjs";

export const usage = "scan [path …] [--json]    one context sheet: each page's first 2.5 s as a filmstrip (default: cfg.pages)";
export const config = "required";

const MARKS = [0, 250, 500, 1000, 1500, 2500]; // ms after the load event; the last frame is the page's still
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function filmstrip(s, cfg, path, url, slug, dir) {
  const { page } = s;
  await installStage(page, cfg.stage);
  await cfg.prepare?.({ page, shot: { id: "scan" } });
  try {
    await page.goto(url, { waitUntil: "load", timeout: 90000 });
  } catch (e) {
    throw new RecError(2, `cannot load ${url}: ${e.message.split("\n")[0]}`);
  }
  const t0 = Date.now();
  await page.addStyleTag({ content: CLEAN_CSS + cfg.css });
  mkdirSync(join(dir, slug), { recursive: true });
  const frames = [];
  for (const ms of MARKS) {
    const wait = t0 + ms - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    const buf = await page.screenshot();
    const file = join(dir, slug, `${ms}.png`);
    writeFileSync(file, buf);
    frames.push({ ms, file, buf });
  }
  const still = join(dir, `${slug}.png`);
  writeFileSync(still, frames.at(-1).buf);
  return {
    path, url, title: await page.title(), still,
    frames,
    moving: frames.some((f, i) => i && !f.buf.equals(frames[i - 1].buf)),
  };
}

export async function run({ cfg, args, flags }) {
  const paths = args.length ? args : (cfg.pages ?? ["/"]);
  const dir = join(cfg.out, ".scan");
  mkdirSync(dir, { recursive: true });
  const { width, height } = cfg.viewport;
  const pages = [];
  for (const path of paths) {
    const url = new URL(path, cfg.url).href;
    const slug = path.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "root";
    const s = await launch({ width, height, dpr: 1, chrome: cfg.chrome }).catch((e) => {
      throw new RecError(2, `cannot start Chrome: ${e.message.split("\n")[0]}`);
    });
    try {
      pages.push(await filmstrip(s, cfg, path, url, slug, dir));
    } finally {
      await s.browser.close().catch(() => {});
    }
  }

  // The sheet is composed in Chrome: one row per page, six captioned frames about 320 px wide.
  const rows = pages.map((p) => `<section><h2>${esc(p.path)} <small>${esc(p.title)} · ${p.moving ? "moving" : "still"}</small></h2><div class="r">${p.frames
    .map((f) => `<figure><img src="data:image/png;base64,${f.buf.toString("base64")}"><figcaption>${f.ms} ms</figcaption></figure>`)
    .join("")}</div></section>`).join("");
  const sheet = join(dir, "sheet.png");
  const s = await launch({ width: 6 * 332 + 12, height: 100, dpr: 1, chrome: cfg.chrome });
  try {
    await s.page.setContent(`<!doctype html><body style="margin:0;padding:6px;background:#fff;font:13px system-ui;color:#111">
<style>h2{margin:10px 0 4px;font-size:15px}small{font-weight:400;color:#555}.r{display:flex;gap:6px}figure{margin:0;width:326px}img{width:320px;display:block;border:1px solid #ccc}figcaption{color:#555;font-size:11px}</style>${rows}`);
    await s.page.screenshot({ path: sheet, fullPage: true });
  } finally {
    await s.browser.close().catch(() => {});
  }

  const out = pages.map((p) => ({ path: p.path, url: p.url, title: p.title, still: p.still, frames: p.frames.map(({ ms, file }) => ({ ms, file })), moving: p.moving }));
  if (flags.json) process.stdout.write(JSON.stringify({ ok: true, sheet, pages: out }) + "\n");
  else {
    for (const p of out) console.log(`${p.path}  ${JSON.stringify(p.title)}  ${p.moving ? "moving" : "still"}  ${p.still}`);
    console.log(`sheet: ${sheet}`);
  }
  return 0;
}
