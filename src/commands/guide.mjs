import { VERBS, COMMON, CAM, SHOT, TARGETS, EXIT, COMMANDS, LOOP, EXAMPLE, INTENTS, TOPICS } from "../vocab.mjs";
import { RecError } from "../config.mjs";

export const usage = "guide [topic|all] [--json]  the vocabulary by topic: " + Object.keys(TOPICS).join(", ");
export const config = "none";

const table = (rows) => rows.map(([a, b]) => `  ${a.padEnd(28)} ${b}`).join("\n");

/** Each topic's text, rendered from src/vocab.mjs. */
const SLICES = {
  steps: () => [
    "STEP VERBS (one per step)",
    table(Object.entries(VERBS).map(([verb, v]) => [`${verb}: ${v.value}`, v.does + (v.options.length ? ` [options: ${v.options.join(", ")}]` : "")])),
    "ANY STEP ALSO TAKES",
    table(Object.entries(COMMON)),
  ],
  shot: () => ["SHOT FIELDS", table(Object.entries(SHOT)), "EXAMPLE: rec/shots/notes-add.mjs", EXAMPLE],
  targets: () => ["TARGETS (must match exactly one element)", table(Object.entries(TARGETS))],
  cam: () => [
    "CAMERA: shot cam: { … }", table(Object.entries(CAM.shot)),
    "cam.auto", table(Object.entries(CAM.auto)),
    "step cam", table(Object.entries(CAM.step)),
    "cam.feel / cam.end", table([...Object.entries(CAM.feel), ...Object.entries(CAM.end)]),
    "YOU WANT → WRITE", table(INTENTS),
  ],
  loop: () => ["THE LOOP", LOOP.map(([s, d], i) => `  ${i + 1}. ${s}: ${d}`).join("\n")],
  commands: async () => {
    const lines = [];
    for (const c of COMMANDS) lines.push("  rec " + (await import(`./${c}.mjs`)).usage);
    return ["COMMANDS (all take --json and --config <file>)", lines.join("\n")];
  },
  exit: () => ["EXIT CODES", table(Object.entries(EXIT))],
};

const text = async (topic) => (await SLICES[topic]()).join("\n\n");

export async function run({ args, flags }) {
  const topic = args[0];
  if (topic && topic !== "all" && !(topic in TOPICS)) throw new RecError(2, `unknown guide topic "${topic}"`, `topics: ${Object.keys(TOPICS).join(" ")} all`);
  if (flags.json) {
    const commands = [];
    for (const c of COMMANDS) commands.push({ name: c, usage: (await import(`./${c}.mjs`)).usage });
    const cam = { auto: Object.keys(CAM.auto), step: Object.keys(CAM.step), feel: Object.keys(CAM.feel), end: Object.keys(CAM.end), shot: CAM.shot, meaning: CAM, intents: INTENTS };
    const all = { loop: LOOP.map(([step, does]) => ({ step, does })), commands, verbs: Object.entries(VERBS).map(([verb, v]) => ({ verb, ...v })), common: COMMON, cam, shot: SHOT, targets: TARGETS, exit: EXIT, example: EXAMPLE };
    const pick = { steps: ["verbs", "common"], shot: ["shot", "example"], targets: ["targets"], cam: ["cam"], loop: ["loop"], commands: ["commands"], exit: ["exit"] }[topic];
    process.stdout.write(JSON.stringify(pick ? Object.fromEntries(pick.map((k) => [k, all[k]])) : all) + "\n");
    return 0;
  }
  if (!topic) {
    console.log(`rec guide <topic>, or rec guide all\n${table(Object.entries(TOPICS))}\nVerbs: ${Object.keys(VERBS).join(" ")}`);
    return 0;
  }
  const topics = topic === "all" ? Object.keys(TOPICS) : [topic];
  const out = [];
  for (const t of topics) out.push(await text(t));
  console.log(out.join("\n\n"));
  return 0;
}
