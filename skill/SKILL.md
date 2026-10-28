---
name: autocap
description: Records polished product demo clips of a web app with autocap (CLI `rec`), an agent-native Screen Studio. It reads the app, plans a story, scripts shots as steps, records them on a slowed clock with a smart camera, and checks every clip without watching it. Use when asked to record, film or capture a web app; to make demo, promo or feature videos, clips, reels or GIFs of an app; to re-record or re-cut rec clips; or when a repo has a rec.config.mjs.
---

# autocap (`rec`)

You write shots as data; `rec` plays them in Chrome on a slowed page clock (every animation lands at 60 fps) and a
camera frames what each step acts on. You never watch video: `rec look` checks each clip (each beat in frame, no
blank stretch) and gives you one contact-sheet image. The vocabulary is fixed and anything else is rejected with the
valid list. `npx rec guide` lists its topics; `npx rec guide <topic>` prints only that part.

## Setup (once per app)
1. `npm i -D github:blueif16/autocap` (needs Google Chrome, ffmpeg, and uv or a Python with Pillow).
2. `npx rec init <app url>`: writes `rec.config.mjs` and `rec/shots/first.mjs`. Start the app.
3. `npx rec doctor`: fix every ✗ with its `fix:` line. `!` lines are warnings.

## The loop: produce each step's artifact before the next
1. **Understand the codebase.** Routes, main features, and what animates or updates live (transitions, streaming
   text, toasts, charts, status changes). Artifact: a feature list, each with its route and files.
2. **Game plan.** Which features deserve a clip, for whom, in what order. Artifact: 3–8 clip ideas, one line each,
   naming the feature and the payoff moment.
3. **Story plan.** Per clip: the beats a viewer must see (the click, then the result landing), the camera and the
   aspect. Artifact: a shot list. A clip is usually 3–8 s with 2–4 beats.
4. **Write.** One file per clip in `rec/shots/<group>-<name>.mjs` (`rec guide shot` has a complete example). Verbs:
   `goto` `click` `hover` `type` `key` `scroll` `drag` `select` `wait` `see` `emit` `run` (`rec guide steps`).
   Take targets from the code: prefer `role=button[name="…"]`, `label=`, `placeholder=`, `testid=`, `text="…"`
   (`rec guide targets`).
5. **Find the pages.** `npx rec scan /route …` prints each page's screenshot and one sheet of what moves after load;
   read them. Then `npx rec check <id>` until it passes: it runs the shot at full speed and names the failing step,
   the target and the fix, with a screenshot.
6. **Record.** `npx rec take <id>` (a 5 s clip takes about 2 minutes), then `npx rec look <id>` and read `look.png`.
   Iterate until `ok` is true, then `npx rec cut <id> --as vertical,gif` for variants.

The default camera zooms on each step's target. When the target is a small control and the viewer needs the card or
panel it sits in, add `frame: "container"` to the step. For anything else (beats only, stay wide, follow, a softer
zoom, a region) run `rec guide cam`: it maps what you want to what you write.

## Rules
- **One target, one element.** If a target matches several elements, `check` lists unique targets for them; use
  the one you meant. ` >> nth=0` is the last resort.
- **Never use pixel boxes for targets.** `region` is for framing only.
- **Stage live data.** AI replies, prices and live feeds must not depend on a live backend during a take:
  `stage.streams` with `emit` steps fakes an EventSource, `stage.rules` answers fetches, `stage.block` stops writes.
- **One take at a time.** `rec` holds a lock, and `take` refuses to start below 1 GB of free disk.
- **Don't edit generated files.** Change the shot and `take` again; `cut` re-renders without recording.

## Done bar: check every item before you report
- [ ] `npx rec check` passes for every shot you wrote.
- [ ] For every take, `npx rec look <id> --json` shows `ok: true`, and you read `look.png` and saw the intended beats.
- [ ] Every clip has ≥ 60 frames per second of page time (`fps` in `take --json`, `capturedFps` in the manifest).
- [ ] Your report lists, per clip: id, what it demonstrates, its beats, and the paths of `smart.mp4` and any variants.
- [ ] If a `rec` command failed or was unclear, your report quotes the command, its `--json` output and `rec doctor`.

If any item fails, fix it and re-check. Don't report a clip you haven't looked at.
