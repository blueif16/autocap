import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RecError } from "../config.mjs";

export const usage = "init [url]               write rec.config.mjs and a first shot in rec/shots/";
export const config = "none";

const CONFIG = (url) => `// agent-recorder config: npx rec guide for the vocabulary.
export default {
  url: ${JSON.stringify(url)},
  out: "rec-assets",
  viewport: { width: 1440, height: 900, dpr: 2 },
  css: "", // CSS that hides dev-only UI in footage, e.g. "nextjs-portal{display:none!important}"
  // Fake backend: streams = EventSource URLs to stage; block = write requests (path regexes) that must not reach the server.
  stage: { cursor: true, streams: [], block: [] },
  pages: ["/"], // what rec scan puts on the context sheet
  shots: "rec/shots", // one shot file each
};
`;

const FIRST = `// A first shot: opens the app and holds on the overview. Replace the steps with your story (npx rec guide).
export default {
  id: "first.look",
  title: "First look at the app",
  steps: [{ wait: 1500, cam: "wide", beat: "the app" }],
};
`;

export async function run({ args, flags }) {
  if (existsSync("rec.config.mjs")) throw new RecError(2, "rec.config.mjs already exists; edit it instead (init never overwrites)");
  writeFileSync("rec.config.mjs", CONFIG(args[0] ?? "http://localhost:3000"));
  mkdirSync(join("rec", "shots"), { recursive: true });
  const first = join("rec", "shots", "first.mjs");
  if (!existsSync(first)) writeFileSync(first, FIRST);
  const next = ["npx rec doctor", "npx rec scan", "npx rec check first", "npx rec take first", "npx rec look first.look"];
  if (flags.json) process.stdout.write(JSON.stringify({ ok: true, files: ["rec.config.mjs", first], next }) + "\n");
  else console.log(`wrote rec.config.mjs and ${first}\nadd rec-assets/.frames/ and rec-assets/.record.lock/ to .gitignore\nnext: ${next.join(" → ")}`);
  return 0;
}
