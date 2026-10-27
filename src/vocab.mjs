// The fixed vocabulary. One source for shot validation, `rec guide` and the skill: if it isn't here, rec rejects it.

/** Step verbs. A step is an object with exactly one of these keys; its value is what the verb acts on. */
export const VERBS = {
  goto: { value: "path or URL", does: "load a page; a path is relative to the config url", options: [] },
  click: { value: "target", does: "glide the cursor to the target and click it", options: ["button", "double"] },
  hover: { value: "target", does: "glide the cursor onto the target (hover states fire)", options: [] },
  type: { value: "text", does: "type the text, into `into` if given (clicks it first); the camera frames the input", options: ["into", "cps", "clear"] },
  key: { value: "key or chord, e.g. Enter, Meta+K", does: "press a key", options: [] },
  scroll: { value: "target, or pixels (number)", does: "smooth-scroll the target to the middle of the view, or scroll by pixels (inside `in` if given)", options: ["in"] },
  drag: { value: "target", does: "press on the target, glide to `to`, release", options: ["to"] },
  select: { value: "target (a <select>)", does: "click the select and choose `value`", options: ["value"] },
  wait: { value: "milliseconds", does: "let the page run (page time)", options: [] },
  see: { value: "target", does: "wait until the target is visible: a moment that needs no click (a card lands, a status flips)", options: ["timeout"] },
  emit: { value: "stream URL part", does: "fire `event` with `data` on a staged EventSource (config stage.streams)", options: ["event", "data"] },
  run: { value: "async ({ page, d, rule, emit }) => {}", does: "custom code for what no verb covers; still timed and recorded", options: [] },
};

/** Options every step accepts. */
export const COMMON = {
  beat: "a label: names this moment in the manifest, poster and `rec look`",
  cam: "camera for this step (see CAM.step)",
  zoom: "zoom level for this step, e.g. 1.8 (implies cam zoom)",
  region: "{ x, y, w, h } CSS px: frame this area instead of the target",
  say: "caption text from this step on (captions.srt)",
  ms: "cursor travel time in ms (default 450)",
  optional: "true: skip the step if its target is missing instead of failing the shot",
};

/** Camera. Shot-level defaults in `cam: {…}`; per-step overrides with `cam: "<mode>"`. */
export const CAM = {
  auto: {
    all: "frame the target of every step that has one (default)",
    clicks: "frame only click, type, select and drag targets",
    beats: "frame only steps with a beat, and see steps",
    off: "stay on the overview unless a step asks for a camera move",
  },
  step: {
    wide: "pull back to the whole window",
    zoom: "punch in on the target (level from `zoom`, else fit with padding)",
    follow: "frame the target, then keep the cursor in view as it moves",
    hold: "keep the current framing; ignore this target",
    pan: "slide to the target at the current zoom level",
    cut: "jump to the target with no camera move",
  },
  feel: { smooth: "default spring", snappy: "faster, tighter", gentle: "slower, softer" },
  end: { wide: "ease back to the overview at the end (default)", hold: "stay on the last framing" },
  shot: { auto: "one of CAM.auto", max: "deepest zoom, default 2.4", pad: "CSS px around a framed target, default 70", feel: "one of CAM.feel", end: "one of CAM.end" },
};

/** Shot fields. A shot has either `steps` or `act` (code), never both. */
export const SHOT = {
  id: "required; `group.name`, unique; prefixes select shots on the CLI",
  title: "required; one line",
  steps: "the recorded steps",
  setup: "steps (or a function) run at full speed before recording: navigate, open panels",
  path: "page to open first, relative to the config url (default /)",
  cam: "shot camera defaults (see CAM.shot)",
  stage: "{ streams, rules, block, cursor } override the config stage for this shot",
  feature: "what product feature it shows (default: the id's group)",
  demonstrates: "what a viewer sees and why it matters (default: title)",
  lead: "ms recorded before the first step (default 300)",
  tail: "ms recorded after the last step (default 900)",
  act: "async ({ page, d }) => {}: a code shot instead of steps",
};

/** Target string syntax (resolved by src/target.mjs). Every target must match exactly one element. */
export const TARGETS = {
  'text=Sign in': "visible text, case-insensitive substring",
  'text="Sign in"': "exact text",
  'role=button[name="Launch"]': "ARIA role + accessible name (best for buttons, links, tabs)",
  "label=Email": "an input by its label",
  "placeholder=you@x.com": "an input by its placeholder",
  "testid=card": "data-testid",
  "alt=Logo · title=Close": "by alt text / title attribute",
  ".card · css=.card · //div": "CSS or XPath",
  "A >> B": "B inside A; `>> nth=0` picks one of several matches",
};

export const EXIT = { 0: "ok", 1: "a shot or check failed", 2: "setup or usage problem", 3: "bad config or shot (validation)" };

export const verbOf = (step) => Object.keys(step).filter((k) => k in VERBS);

/** CLI commands, in the order an agent meets them. Each lives in src/commands/<name>.mjs. */
export const COMMANDS = ["guide", "doctor", "init", "skill", "scan", "ls", "check", "take", "cut", "look"];

/** The loop the skill teaches: what to do, and what each step produces. */
export const LOOP = [
  ["Understand the codebase", "read routes, main features, and what animates or updates live → a feature list with file paths"],
  ["Game plan", "which features deserve a clip, for whom, in what order → 3–8 clip ideas, one line each"],
  ["Story plan", "per clip: the beats a viewer must see, the camera style, the aspect → a shot list"],
  ["Write", "one shot file per clip in rec/shots/, using only this vocabulary"],
  ["Find the pages", "rec scan <paths> for a context sheet of the running app; targets come from the code; rec check until every target resolves"],
  ["Record", "rec take, then rec look until ok is true, then rec cut --as vertical,gif for variants"],
];

export const EXAMPLE = `export default {
  id: "notes.add",
  title: "Add a note and watch it land",
  path: "/",
  cam: { auto: "clicks" },
  steps: [
    { type: "Buy milk", into: "placeholder=New note", say: "Jot it down" },
    { click: 'role=button[name="Add"]', beat: "add" },
    { see: "text=Buy milk", beat: "note lands", cam: "follow" },
    { wait: 600, cam: "wide" },
  ],
};`;
