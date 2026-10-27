import { pickShots } from "../config.mjs";

export const usage = "take [prefix …]          record shots into <out>/effects/<id>/ and the manifest";
export const config = "required";

/** Shared by take and check: runs each shot, keeps going after a failure, exit 1 if any failed. */
export async function runShots({ cfg, args, flags }, check) {
  const { take } = await import("../take.mjs");
  const shots = pickShots(cfg, args);
  if (!check) (await import("./doctor.mjs")).preflight(cfg);
  const results = [];
  for (const s of shots) {
    try {
      const r = await take(s, cfg, { check });
      results.push({ id: s.id, ok: true, ...r });
    } catch (e) {
      const r = { id: s.id, ok: false, error: e.message.split("\n")[0], ...(e.step ?? {}) };
      if (e.screenshot) r.screenshot = e.screenshot;
      results.push(r);
      console.error(`  ✗ ${s.id}: ${r.step !== undefined ? `step ${r.step} (${r.verb}) ` : ""}${r.error}`);
    }
  }
  const ok = results.every((r) => r.ok);
  if (flags.json) process.stdout.write(JSON.stringify({ ok, results }) + "\n");
  return ok ? 0 : 1;
}

export const run = (ctx) => runShots(ctx, false);
