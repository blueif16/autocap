---
name: autocap
description: Make polished product demo clips of a web app with autocap (CLI `rec`), an agent-native Screen Studio: understand the app, plan a story, script shots as steps, record them on a slowed clock with a smart camera, and verify every clip without watching it. TRIGGER when asked to record, film or capture a web app, make demo/promo/feature videos, clips, reels or GIFs of an app, re-record or re-cut existing rec clips, or when a repo has a rec.config.mjs.
---

# autocap (`rec`)

You write shots as data; `rec` plays them in Chrome with the page clock slowed (every animation is captured at
60 fps), and a camera frames what each step says. You never watch video: `rec look` gives you one contact-sheet
image and a framing report per clip. Run `npx rec guide` for the full vocabulary; it is the source of truth.

## Setup (once per app)
1. `npm i -D github:blueif16/autocap` (needs Google Chrome, ffmpeg, and uv or a Python with Pillow).
2. `npx rec doctor`: fix every ✗ using its `fix:` line before going further. `!` lines are warnings.
3. `npx rec init <app url>`: writes `rec.config.mjs` and `rec/shots/first.mjs`. Start the app, then `npx rec take first`.

## The loop: do these in order, and produce each step's artifact before the next
1. **Understand the codebase.** Read the routes, the main features, and what animates or updates live (transitions,
   streaming text, toasts, charts, status changes). Artifact: a feature list, each with its route and files.
2. **Game plan.** Decide which features deserve a clip, for whom, in what order. Artifact: 3–8 clip ideas, one line
   each, naming the feature and the payoff moment.
3. **Story plan.** For each clip: the beats a viewer must see (the click, then the result landing), the camera
   style, and the aspect. Artifact: a shot list. A clip is usually 3–8 s with 2–4 beats.
4. **Write.** One file per clip in `rec/shots/<group>-<name>.mjs`, using only verbs and options from `rec guide`.
   Put targets from the code: prefer `role=button[name="…"]`, `label=`, `placeholder=`, `testid=`, `text="…"`.
5. **Find the pages.** `npx rec scan /route /other` gives a context sheet (`.scan/sheet.png`; read it) of
   each page and what moves after load. Then `npx rec check <id>` until it passes: it runs the shot at full speed and
   names the failing step, the target and the fix, with a screenshot in `<out>/.debug/<id>.png`.
6. **Record.** `npx rec take <id>`, then `npx rec look <id>` (read `look.png`). Iterate until `ok` is true, then
   `npx rec cut <id> --as vertical,gif` for variants.

## Camera: intent → setting
| You want | Write |
|---|---|
| Zoom on every click / typed field (default) | nothing, or shot `cam: { auto: "all" }` |
| Zoom only on clicks, not hovers | shot `cam: { auto: "clicks" }` |
| Zoom only on the moments that matter | shot `cam: { auto: "beats" }` + `beat:` on those steps |
| Keep the overview the whole time | shot `cam: { auto: "off" }`, or `rec cut --cam off` afterwards |
| Pull back for one step | step `cam: "wide"` |
| A fixed punch-in level | step `zoom: 1.8` |
| Track the cursor across a drag or a long move | step `cam: "follow"` |
| Don't move for this step | step `cam: "hold"` |
| Slide sideways at the same zoom | step `cam: "pan"` |
| Hard cut instead of a move | step `cam: "cut"` |
| Frame an area, not an element | step `region: { x, y, w, h }` (CSS px) |
| A result appears with no click (card lands, status flips) | `{ see: "<target>", beat: "…" }` |

## Rules
- **One target, one element.** If `check` reports several matches, make the target more specific or append ` >> nth=0`.
- **Never use pixel boxes for targets.** `region` is for framing only.
- **Stage live data.** AI replies, prices and real-time feeds must not depend on a live backend during a take:
  - `stage.streams` makes a fake EventSource; drive it with `emit` steps.
  - `stage.rules` / `run: ({ rule }) => rule({ kind: "json" | "stream", url, body | text })` answer fetches.
  - `stage.block` stops writes from reaching the server.
- **One take at a time.** `rec` holds a lock. If `doctor` warns about swap, restart the app's dev server first.
- **Don't edit generated files.** Change the shot, then `take` again. Use `cut` to re-render without recording.

## Done bar: check every item before you report
- [ ] `npx rec check` passes for every shot you wrote.
- [ ] For every take, `npx rec look <id> --json` shows `ok: true`, and you read `look.png` and saw the intended beats.
- [ ] The manifest (`<out>/manifest.json`) shows `capturedFps ≥ 60` for every clip. If not, `doctor`, then re-take.
- [ ] Your report lists, per clip: id, what it demonstrates, its beats, and the paths of `smart.mp4` and any variants.
If any item fails, fix it and re-check. Don't report a clip you haven't looked at.
