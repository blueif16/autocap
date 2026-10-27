import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const usage = "skill [--install] [--dir d]  print the agent skill, or install it (default ~/.claude/skills)";
export const config = "none";

export async function run({ flags }) {
  const md = readFileSync(join(import.meta.dirname, "..", "..", "skill", "SKILL.md"), "utf8");
  if (!flags.install) {
    process.stdout.write(flags.json ? JSON.stringify({ ok: true, skill: md }) + "\n" : md);
    return 0;
  }
  const dir = join(flags.dir ?? join(homedir(), ".claude", "skills"), "agent-recorder");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), md);
  if (flags.json) process.stdout.write(JSON.stringify({ ok: true, path: join(dir, "SKILL.md") }) + "\n");
  else console.log(`installed ${join(dir, "SKILL.md")}`);
  return 0;
}
