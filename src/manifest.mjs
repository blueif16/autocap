// manifest.json: one entry per asset, saying what it shows and why, so an editing agent can cut by story beat.
// Each entry is its own file under <out>/.manifest/ (parallel recorders never overwrite each other), merged into
// <out>/manifest.json after every write.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

/** Write via a temp file and rename, so a kill mid-write never leaves half a JSON file. */
function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Path relative to the output folder, as stored in the manifest. */
export const rel = (out, p) => p.replace(out + "/", "");

/** features: optional { key: description }; when given, every entry's `feature` must be one of its keys. */
export function addToManifest(out, entry, features = null) {
  for (const k of ["feature", "title", "demonstrates", "files"]) if (!entry[k]) throw new Error(`manifest entry ${entry.id} is missing ${k}`);
  if (features && !features[entry.feature]) throw new Error(`manifest entry ${entry.id}: unknown feature ${entry.feature}`);
  const dir = join(out, ".manifest");
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2));
  rebuildManifest(out, features);
}

/** Merges `patch.files` into an existing entry (e.g. a re-rendered smart.mp4). */
export function patchManifest(out, id, patch, features = null) {
  const f = join(out, ".manifest", `${id}.json`);
  if (!existsSync(f)) return;
  const e = JSON.parse(readFileSync(f, "utf8"));
  writeAtomic(f, JSON.stringify({ ...e, ...patch, files: { ...e.files, ...(patch.files ?? {}) } }, null, 2));
  rebuildManifest(out, features);
}

export function rebuildManifest(out, features = null) {
  const dir = join(out, ".manifest");
  mkdirSync(dir, { recursive: true });
  const path = join(out, "manifest.json");
  const assets = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let e;
    try {
      e = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch (err) {
      console.error(`  skipping damaged manifest entry ${join(dir, f)} (${err.message}); re-take that shot to restore it`);
      continue;
    }
    assets[e.id] = e;
  }
  writeAtomic(path, JSON.stringify({ generated: new Date().toISOString(), features: features ?? {}, assets }, null, 2));
}
