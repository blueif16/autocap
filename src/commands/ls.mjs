export const usage = "ls [prefix …]            list shots: id, feature, title";
export const config = "required";

export async function run({ cfg, args, flags }) {
  const pick = args.length ? cfg.shots.filter((s) => args.some((a) => s.id.startsWith(a))) : cfg.shots;
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, shots: pick.map((s) => ({ id: s.id, feature: s.feature, title: s.title, format: s.steps ? "steps" : "act" })) }) + "\n");
    return 0;
  }
  for (const s of pick) console.log(`${s.id.padEnd(34)} ${s.feature.padEnd(16)} ${s.title}`);
  return 0;
}
