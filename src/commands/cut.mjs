import { existsSync } from "node:fs";
import { join } from "node:path";
import { pickShots } from "../config.mjs";
import { render } from "../camera.mjs";
import { patchManifest, rel } from "../manifest.mjs";

export const usage = "cut [prefix …]           re-render smart.mp4 from existing takes (no re-recording)";
export const config = "required";

export async function run({ cfg, args, flags }) {
  const cuts = [];
  for (const s of pickShots(cfg, args)) {
    const dir = join(cfg.out, "effects", s.id);
    if (!existsSync(join(dir, "timeline.json"))) continue;
    const out = render(dir, { python: cfg.python });
    patchManifest(cfg.out, `effect.${s.id}`, { files: { smart: rel(cfg.out, out) } }, cfg.features);
    cuts.push({ id: s.id, smart: rel(cfg.out, out) });
    console.log(`  ${s.id}: ${rel(cfg.out, out)}`);
  }
  if (flags.json) process.stdout.write(JSON.stringify({ ok: true, cuts }) + "\n");
  return 0;
}
