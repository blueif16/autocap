// rec.config.mjs: the app adapter. Everything app-specific lives there; the core reads only what's below.
//   url        the app (required)                  out        output folder (default rec-assets)
//   viewport   { width, height, dpr }              css        extra CSS hiding dev chrome in footage
//   stage      { cursor, streams, block, blockText, ripple }  (see stage.mjs)
//   features   { key: description }: when given, every shot's `feature` must be a key
//   prepare({ page, shot })  app init scripts, run after the stage is installed and before the page loads
//   console    regex: page console lines echoed during `rec check`
//   chrome     Chrome executable
//   extras     ["focus", "slowmo"]: clips a take also writes (default none: smart.mp4, full.mp4, poster, timeline)
//   slowmo     slow-motion factor for the slowmo extra (default 3)      shots      [shot], or a folder of shot files
//   pages      paths `rec scan` puts on the context sheet (default ["/"])
// A shot: { id, feature, title, demonstrates, act({ page, d }), setup?, routes?, stage?, focus?, lead?, tail?,
//   pad?, posterAtMs?, suggestedUse?, staged? } and any app fields `prepare` reads.
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSteps } from "./steps.mjs";
import { CAM } from "./vocab.mjs";

/** An error with the exit code rec should end with: 1 shot failed · 2 setup/usage · 3 bad config or shot. `fix` says what to do. */
export class RecError extends Error {
  constructor(code, message, fix) {
    super(message);
    this.code = code;
    if (fix) this.fix = fix;
  }
}

/** Import a config or shot file; a file that doesn't parse or throws is a bad config (exit 3), named. */
const importFile = (path) => import(pathToFileURL(path).href).catch((e) => {
  throw new RecError(3, `${path}: ${e.message}`);
});

export async function loadConfig(file) {
  const path = resolve(file ?? "rec.config.mjs");
  if (!existsSync(path)) throw new RecError(2, `no rec.config.mjs at ${path} (run rec in the app's folder or pass --config <file>)`);
  const c = (await importFile(path)).default ?? {};
  if (!c.url) throw new RecError(3, `${path}: url is required`);
  const EXTRAS = ["focus", "slowmo"];
  for (const x of c.extras ?? []) if (!EXTRAS.includes(x)) throw new RecError(3, `${path}: extras "${x}" is not a clip a take can add (valid: ${EXTRAS.join(", ")})`);
  const dir = dirname(path);
  const shots = typeof c.shots === "string" ? await shotFolder(resolve(dir, c.shots)) : c.shots ?? [];
  const seen = new Set();
  for (const s of shots) {
    if (!s.id) throw new RecError(3, `a shot has no id (${s.title ?? "untitled"})`);
    // The id names folders under <out>: ".." would make a take wipe the output folder.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s.id)) throw new RecError(3, `shot id "${s.id}": use letters, digits, ".", "_" and "-", starting with a letter or digit`);
    if (seen.has(s.id)) throw new RecError(3, `duplicate shot id ${s.id}`);
    seen.add(s.id);
    if (!s.title) throw new RecError(3, `shot ${s.id} is missing title`);
    if (!!s.steps === (typeof s.act === "function")) throw new RecError(3, `shot ${s.id} needs exactly one of steps or act({ page, d })`);
    s.feature ??= s.id.split(".")[0];
    s.demonstrates ??= s.title;
    try {
      if (s.steps) validateSteps(s.steps, `shot ${s.id} `);
      if (Array.isArray(s.setup)) validateSteps(s.setup, `shot ${s.id} setup `);
    } catch (e) {
      throw new RecError(3, e.message);
    }
    for (const [k, v] of Object.entries(s.cam ?? {})) {
      const allowed = { auto: CAM.auto, feel: CAM.feel, end: CAM.end }[k];
      if (allowed && !(v in allowed)) throw new RecError(3, `shot ${s.id}: cam.${k} "${v}" (valid: ${Object.keys(allowed).join(", ")})`);
      if (!allowed && !["max", "pad"].includes(k)) throw new RecError(3, `shot ${s.id}: unknown cam setting ${k} (valid: ${Object.keys(CAM.shot).join(", ")})`);
    }
    if (c.features && !c.features[s.feature]) throw new RecError(3, `shot ${s.id}: unknown feature ${s.feature}`);
  }
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
    chrome: c.chrome,
    extras: c.extras ?? [],
    slowmo: c.slowmo ?? 3,
    pages: c.pages ?? ["/"],
    shots,
  };
}

/** Shots whose id starts with any prefix (all shots when no prefix). A prefix matching nothing is an error (exit 1). */
export function pickShots(cfg, prefixes) {
  if (!prefixes.length) return cfg.shots;
  const pick = cfg.shots.filter((s) => prefixes.some((a) => s.id.startsWith(a)));
  if (!pick.length) throw new RecError(1, `no shot matches ${prefixes.join(" ")}`);
  return pick;
}

/** Every .mjs in the folder; each default-exports a shot or an array of shots. */
async function shotFolder(folder) {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new RecError(3, `shots folder ${folder} does not exist`);
  const shots = [];
  for (const f of readdirSync(folder).filter((f) => f.endsWith(".mjs")).sort()) {
    const d = (await importFile(join(folder, f))).default;
    if (!d) throw new RecError(3, `${join(folder, f)} has no default export (a shot or an array of shots)`);
    shots.push(...(Array.isArray(d) ? d : [d]));
  }
  return shots;
}
