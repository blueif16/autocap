import { VERBS, COMMON, CAM, SHOT, TARGETS, EXIT, COMMANDS, LOOP, EXAMPLE } from "../vocab.mjs";

export const usage = "guide [--json]           the whole vocabulary: loop, commands, steps, camera, targets";
export const config = "none";

export async function run({ flags }) {
  const commands = [];
  for (const c of COMMANDS) commands.push({ name: c, usage: (await import(`./${c}.mjs`)).usage });
  const verbs = Object.entries(VERBS).map(([verb, v]) => ({ verb, ...v }));
  const cam = { auto: Object.keys(CAM.auto), step: Object.keys(CAM.step), feel: Object.keys(CAM.feel), end: Object.keys(CAM.end), shot: CAM.shot, meaning: CAM };
  if (flags.json) {
    process.stdout.write(JSON.stringify({ loop: LOOP.map(([step, does]) => ({ step, does })), commands, verbs, common: COMMON, cam, shot: SHOT, targets: TARGETS, exit: EXIT, example: EXAMPLE }) + "\n");
    return 0;
  }
  const out = [];
  const table = (rows) => rows.map(([a, b]) => `  ${a.padEnd(28)} ${b}`).join("\n");
  out.push("THE LOOP", LOOP.map(([s, d], i) => `  ${i + 1}. ${s}: ${d}`).join("\n"));
  out.push("COMMANDS (all take --json)", commands.map((c) => "  rec " + c.usage).join("\n"));
  out.push("SHOT FIELDS", table(Object.entries(SHOT)));
  out.push("STEP VERBS (one per step)", table(verbs.map((v) => [`${v.verb}: ${v.value}`, v.does + (v.options.length ? ` [options: ${v.options.join(", ")}]` : "")])));
  out.push("ANY STEP ALSO TAKES", table(Object.entries(COMMON)));
  out.push("CAMERA: shot cam.auto", table(Object.entries(CAM.auto)));
  out.push("CAMERA: step cam", table(Object.entries(CAM.step)));
  out.push("CAMERA: shot cam.feel / cam.end", table([...Object.entries(CAM.feel), ...Object.entries(CAM.end)]));
  out.push("TARGETS (must match exactly one element)", table(Object.entries(TARGETS)));
  out.push("EXAMPLE: rec/shots/notes-add.mjs", EXAMPLE);
  out.push("EXIT CODES", table(Object.entries(EXIT)));
  console.log(out.join("\n\n"));
  return 0;
}
