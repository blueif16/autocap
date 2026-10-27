#!/usr/bin/env node
// rec: record scripted demo clips of a web app. Reads rec.config.mjs from the current folder (or --config <file>).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, RecError } from "../src/config.mjs";

const USAGE = `rec <command> [shot-id-prefix …] [--config <file>]
  ls      list shots: id, feature, title
  check   run shots at full speed without recording; screenshot in <out>/.debug/<id>.png
  take    record shots into <out>/effects/<id>/ and the manifest
  cut     re-render smart.mp4 for shots that have a take
Exit: 0 ok · 1 a shot failed · 2 setup or usage · 3 bad config or shot`;

async function main(argv) {
  let configFile;
  const args = [];
  for (let i = 0; i < argv.length; i++) argv[i] === "--config" ? (configFile = argv[++i]) : args.push(argv[i]);
  const [cmd, ...ids] = args;
  if (!cmd || cmd === "help" || cmd === "--help") return console.log(USAGE), 0;
  if (!["ls", "check", "take", "cut"].includes(cmd)) throw new RecError(2, `unknown command ${cmd}\n${USAGE}`);

  const cfg = await loadConfig(configFile);
  const pick = ids.length ? cfg.shots.filter((s) => ids.some((a) => s.id.startsWith(a))) : cfg.shots;
  if (cmd === "ls") {
    for (const s of pick) console.log(`${s.id.padEnd(34)} ${s.feature.padEnd(16)} ${s.title}`);
    return 0;
  }
  if (ids.length && !pick.length) throw new RecError(1, `no shot matches ${ids.join(" ")}`);

  if (cmd === "cut") {
    const { render } = await import("../src/camera.mjs");
    const { patchManifest, rel } = await import("../src/manifest.mjs");
    for (const s of pick) {
      const dir = join(cfg.out, "effects", s.id);
      if (!existsSync(join(dir, "timeline.json"))) continue;
      const out = render(dir, { python: cfg.python });
      patchManifest(cfg.out, `effect.${s.id}`, { files: { smart: rel(cfg.out, out) } }, cfg.features);
      console.log(`  ${s.id}: ${rel(cfg.out, out)}`);
    }
    return 0;
  }

  const { take } = await import("../src/take.mjs");
  let failed = 0;
  for (const s of pick) {
    try {
      await take(s, cfg, { check: cmd === "check" });
    } catch (e) {
      failed++;
      console.error(`  ✗ ${s.id}: ${e.message.split("\n")[0]}`);
    }
  }
  return failed ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`rec: ${e.message}`);
    process.exit(e instanceof RecError ? e.code : 1);
  },
);
