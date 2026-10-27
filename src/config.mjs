// rec.config.mjs: the app adapter. Everything app-specific lives there; the core reads only what's below.
//   url        the app (required)                  out        output folder (default rec-assets)
//   viewport   { width, height, dpr }              css        extra CSS hiding dev chrome in footage
//   stage      { cursor, streams, block, blockText, ripple }  (see stage.mjs)
//   features   { key: description }: when given, every shot's `feature` must be a key
//   prepare({ page, shot })  app init scripts, run after the stage is installed and before the page loads
//   console    regex: page console lines echoed during `rec check`
//   python     interpreter with Pillow for the camera renderer   chrome  Chrome executable
//   slowmo     slow-motion factor (default 3)      shots      [shot]
// A shot: { id, feature, title, demonstrates, act({ page, d }), setup?, routes?, stage?, focus?, lead?, tail?,
//   pad?, posterAtMs?, suggestedUse?, staged? } and any app fields `prepare` reads.
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

/** An error with the exit code rec should end with: 1 shot failed · 2 setup/usage · 3 bad config or shot. */
export class RecError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function loadConfig(file) {
  const path = resolve(file ?? "rec.config.mjs");
  if (!existsSync(path)) throw new RecError(2, `no rec.config.mjs at ${path} (run rec in the app's folder or pass --config <file>)`);
  const c = (await import(pathToFileURL(path).href)).default ?? {};
  if (!c.url) throw new RecError(3, `${path}: url is required`);
  const shots = c.shots ?? [];
  const seen = new Set();
  for (const s of shots) {
    if (!s.id) throw new RecError(3, `a shot has no id (${s.title ?? "untitled"})`);
    if (seen.has(s.id)) throw new RecError(3, `duplicate shot id ${s.id}`);
    seen.add(s.id);
    for (const k of ["feature", "title", "demonstrates"]) if (!s[k]) throw new RecError(3, `shot ${s.id} is missing ${k}`);
    if (typeof s.act !== "function") throw new RecError(3, `shot ${s.id} is missing act({ page, d })`);
    if (c.features && !c.features[s.feature]) throw new RecError(3, `shot ${s.id}: unknown feature ${s.feature}`);
  }
  const dir = dirname(path);
  return {
    dir,
    file: path,
    url: c.url,
    out: resolve(dir, c.out ?? "rec-assets"),
    viewport: { width: 1440, height: 900, dpr: 2, ...c.viewport },
    css: c.css ?? "",
    stage: { cursor: true, streams: [], block: [], blockText: [], ...c.stage },
    features: c.features ?? null,
    prepare: c.prepare,
    console: c.console ? new RegExp(c.console) : null,
    python: c.python && c.python.includes("/") ? resolve(dir, c.python) : c.python,
    chrome: c.chrome,
    slowmo: c.slowmo ?? 3,
    shots,
  };
}
