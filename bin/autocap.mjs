#!/usr/bin/env node
// rec: record scripted demo clips of a web app. Commands live in src/commands/<name>.mjs; each exports
// `usage` (one line), `config` ("required" | "optional" | "none") and `run({ cfg, args, flags }) → exit code`.
// Every flag a command accepts appears in its usage line; any other flag is rejected.
// --json: stdout carries exactly one JSON document; progress goes to stderr.
import { loadConfig, RecError } from "../src/config.mjs";
import { COMMANDS } from "../src/vocab.mjs";

const BOOLEAN = new Set(["json", "install", "help"]);
const GLOBAL = ["json", "config", "help"];

function parse(argv) {
  const args = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { args.push(a); continue; }
    const eq = a.indexOf("=");
    const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
    flags[k] = eq < 0 ? (BOOLEAN.has(k) ? true : argv[++i]) : a.slice(eq + 1);
  }
  return { cmd: args.shift(), args, flags };
}

async function usage() {
  const lines = [];
  for (const c of COMMANDS) lines.push("  " + (await import(`../src/commands/${c}.mjs`)).usage);
  return `rec <command> … [--json] [--config <file>]\n${lines.join("\n")}\nExit: 0 ok · 1 a shot or check failed · 2 setup or usage · 3 bad config or shot. Start with: rec skill (the procedure), then rec guide (the vocabulary)`;
}

async function main(argv) {
  const { cmd, args, flags } = parse(argv);
  if (!cmd || cmd === "help") return console.log(await usage()), 0;
  if (!COMMANDS.includes(cmd)) throw new RecError(2, `unknown command "${cmd}"`, `commands: ${COMMANDS.join(" ")} (rec --help)`);
  const mod = await import(`../src/commands/${cmd}.mjs`);
  const known = [...GLOBAL, ...[...mod.usage.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1])];
  const unknown = Object.keys(flags).find((k) => !known.includes(k));
  if (unknown) throw new RecError(2, `unknown flag --${unknown} for rec ${cmd}`, `flags: ${[...new Set(known)].map((k) => "--" + k).join(" ")}`);
  if (flags.help) return console.log(`rec ${mod.usage}\nGlobal: --json (one JSON document on stdout) · --config <file> (default ./rec.config.mjs)`), 0;
  if (flags.json) console.log = console.error; // keep stdout for the JSON result
  let cfg = null;
  if (mod.config === "required") cfg = await loadConfig(flags.config);
  else if (mod.config === "optional") cfg = await loadConfig(flags.config).catch((e) => e);
  return mod.run({ cfg, args, flags });
}

// Exit only once stdout has drained: process.exit() on a pipe drops whatever is still buffered past 64 KB.
const exit = (code) => process.stdout.write("", () => process.exit(code));

main(process.argv.slice(2)).then(
  (code) => exit(code ?? 0),
  (e) => {
    const code = e instanceof RecError ? e.code : 1;
    if (process.argv.includes("--json")) process.stdout.write(JSON.stringify({ ok: false, error: e.message, ...(e.fix && { fix: e.fix }), exit: code }) + "\n");
    console.error(`rec: ${e.message}${e.fix ? `\n  fix: ${e.fix}` : ""}`);
    exit(code);
  },
);
