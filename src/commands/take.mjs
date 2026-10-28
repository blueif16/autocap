import { join, relative } from "node:path";
import { pickShots } from "../config.mjs";

export const usage = "take [prefix …]          record shots into <out>/effects/<id>/ and the manifest";
export const config = "required";

/** A path as the agent's shell would type it: relative to the current folder. */
const here = (p) => relative(process.cwd(), p) || ".";

/** Shared by take and check: runs each shot, keeps going after a failure, exit 1 if any failed. */
export async function runShots({ cfg, args, flags }, check) {
  const { take } = await import("../take.mjs");
  const shots = pickShots(cfg, args);
  if (!check) await (await import("./doctor.mjs")).preflight(cfg);
  const results = [];
  for (const s of shots) {
    try {
      const r = await take(s, cfg, { check });
      if (!check) r.smart = here(join(r.dir, "smart.mp4"));
      results.push({ id: s.id, ok: true, ...r });
      if (!flags.json) console.log(check ? `  ✓ ${s.id}  ${r.steps} steps · beats: ${r.beats.join(", ") || "none"}` : `  ✓ ${s.id}  smart: ${r.smart}`);
    } catch (e) {
      const r = { id: s.id, ok: false, error: e.message.split("\n")[0], ...(e.step ?? {}) };
      if (e.screenshot) r.screenshot = here(e.screenshot);
      results.push(r);
      console.error(`  ✗ ${s.id}: ${r.step !== undefined ? `step ${r.step} (${r.verb}) ` : ""}${r.error}${r.screenshot ? `\n    screenshot: ${r.screenshot}` : ""}`);
    }
  }
  const ok = results.every((r) => r.ok);
  const ids = results.map((r) => r.id).join(" ");
  const next = !ok ? `fix the failing step, then rec check ${results.filter((r) => !r.ok).map((r) => r.id).join(" ")}`
    : check ? `rec take ${ids}` : results.map((r) => `rec look ${r.id}`).join(" · ");
  if (flags.json) process.stdout.write(JSON.stringify({ ok, results, next }) + "\n");
  else console.log(`next: ${next}`);
  return ok ? 0 : 1;
}

export const run = (ctx) => runShots(ctx, false);
