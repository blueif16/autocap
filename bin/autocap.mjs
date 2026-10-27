#!/usr/bin/env node
// rec: record scripted demo clips of a web app. Commands live in src/commands/<name>.mjs; each exports
// `usage` (one line), `config` ("required" | "optional" | "none") and `run({ cfg, args, flags }) → exit code`.
// --json: stdout carries exactly one JSON document; progress goes to stderr.
import { loadConfig, RecError } from "../src/config.mjs";
import { COMMANDS } from "../src/vocab.mjs";

const BOOLEAN = new Set(["json", "install", "help"]);

function parse(argv) {
  const args = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { args.push(a); continue; }
    const [k, v] = a.slice(2).split("=", 2);
    flags[k] = v ?? (BOOLEAN.has(k) ? true : argv[++i]);
  }
  return { cmd: args.shift(), args, flags };
}

async function usage() {
  const lines = [];
  for (const c of COMMANDS) lines.push("  " + (await import(`../src/commands/${c}.mjs`)).usage);
  return `rec <command> … [--json] [--config <file>]\n${lines.join("\n")}\nExit: 0 ok · 1 a shot or check failed · 2 setup or usage · 3 bad config or shot. Start with: rec guide`;
}

async function main(argv) {
  const { cmd, args, flags } = parse(argv);
  if (!cmd || cmd === "help" || flags.help) return console.log(await usage()), 0;
  if (!COMMANDS.includes(cmd)) throw new RecError(2, `unknown command ${cmd}\n${await usage()}`);
  if (flags.json) console.log = console.error; // keep stdout for the JSON result
  const mod = await import(`../src/commands/${cmd}.mjs`);
  let cfg = null;
  if (mod.config === "required") cfg = await loadConfig(flags.config);
  else if (mod.config === "optional") cfg = await loadConfig(flags.config).catch((e) => e);
  return mod.run({ cfg, args, flags });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (e) => {
    if (process.argv.includes("--json")) process.stdout.write(JSON.stringify({ ok: false, error: e.message, exit: e instanceof RecError ? e.code : 1 }) + "\n");
    console.error(`rec: ${e.message}`);
    process.exit(e instanceof RecError ? e.code : 1);
  },
);
