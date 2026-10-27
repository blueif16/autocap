import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pickShots, RecError } from "../config.mjs";
import { render } from "../camera.mjs";
import { patchManifest, rel } from "../manifest.mjs";
import { CAM } from "../vocab.mjs";

export const usage = "cut [prefix …] [--as wide,vertical,square,gif] [--cam all|clicks|beats|off]   re-render from takes, no re-recording";
export const config = "required";

const AS = { wide: "16:9", vertical: "9:16", square: "1:1" };

/** smart.mp4 · smart-9x16.mp4 · smart-off.mp4 · smart-1x1-beats.mp4 … */
const nameOf = (aspect, cam) => `smart${aspect === "16:9" ? "" : "-" + aspect.replace(":", "x")}${cam ? "-" + cam : ""}.mp4`;

function gif(mp4, out) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", mp4, "-vf", "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", out]);
}

export async function run({ cfg, args, flags }) {
  const formats = String(flags.as ?? "wide").split(",").map((f) => f.trim());
  for (const f of formats) if (f !== "gif" && !AS[f]) throw new RecError(2, `--as ${f}: use wide, vertical, square or gif`);
  if (flags.cam && !(flags.cam in CAM.auto)) throw new RecError(2, `--cam ${flags.cam}: use ${Object.keys(CAM.auto).join(", ")}`);
  const cam = flags.cam ? { auto: flags.cam } : undefined;
  const cuts = [];
  for (const s of pickShots(cfg, args)) {
    const dir = join(cfg.out, "effects", s.id);
    if (!existsSync(join(dir, "timeline.json"))) {
      console.error(`  ${s.id}: no take yet (rec take ${s.id})`);
      continue;
    }
    const files = {};
    for (const f of formats) {
      const aspect = AS[f] ?? "16:9";
      const name = nameOf(aspect, flags.cam);
      const mp4 = join(dir, name);
      if (!files[name.replace(".mp4", "")]) render(dir, { python: cfg.python, aspect, cam, name });
      files[name.replace(".mp4", "")] = rel(cfg.out, mp4);
      if (f === "gif") {
        const g = mp4.replace(/\.mp4$/, ".gif");
        gif(mp4, g);
        files[name.replace(".mp4", "") + "-gif"] = rel(cfg.out, g);
      }
    }
    patchManifest(cfg.out, `effect.${s.id}`, { files }, cfg.features);
    cuts.push({ id: s.id, files });
    console.log(`  ${s.id}: ${Object.values(files).join(", ")}`);
  }
  if (flags.json) process.stdout.write(JSON.stringify({ ok: true, cuts }) + "\n");
  return 0;
}
