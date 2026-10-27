# autocap

An agent-native Screen Studio. `autocap` records polished demo clips of a web app, driven entirely by a coding
agent. There is no MCP server: it is a CLI plus one skill. The CLI answers to `autocap` and to the short `rec`.

- **Smooth capture.** The page clock is slowed during capture, so every spring, fade and pop is caught at 60 fps.
- **Shots are steps, not code.** A fixed vocabulary of 12 verbs, validated before anything runs.
- **A camera that understands the UI.** It zooms on the elements your steps act on, including results that appear with
  no click (`see`). Styles per shot or per step: zoom on everything, clicks only or beats only; stay wide; follow;
  hold; pan; cut; zoom level; region. Any aspect: 16:9, 9:16, 1:1.
- **Staged backends.** Fake EventSource streams and fetch answers, so AI or live data plays the same every take.
- **Agents verify without watching.** `rec look` gives a contact sheet plus a per-beat framing report; `rec scan`
  gives a context sheet of the running app.

## For coding agents: start here

If you were asked to use autocap on a project, this section and the skill are the whole procedure.

1. **Install** in the project root: `npm i -D github:blueif16/autocap`. It needs Google Chrome, ffmpeg, and uv (or a
   Python with Pillow).
2. **Load the skill**: run `npx rec skill --install`, then read `~/.claude/skills/autocap/SKILL.md` in full
   (`npx rec skill` prints it if you can't read that path). Follow it. `npx rec guide` lists the exact vocabulary.
3. **Set up**:
   - Run `npx rec doctor` and fix every ✗ with the `fix:` line it prints, until none are left.
   - Run `npx rec init <the app's url>`, then start the app.
4. **Work the loop, in order, producing each step's artifact before the next:**
   1. Understand the codebase: a feature list with routes and files.
   2. Game plan: 3–8 clip ideas.
   3. Story plan: the beats, camera and aspect for each clip.
   4. Write: one shot file per clip in `rec/shots/`.
   5. Find the pages: `npx rec scan` for a context sheet, then `npx rec check` until every shot passes.
   6. Record: `npx rec take`, then `npx rec look` until `ok: true`, then `npx rec cut --as vertical,gif`.
5. **You are done when all of these hold:**
   - every shot passes `check`;
   - every take's `npx rec look <id> --json` has `ok: true`, and you have read its `look.png`;
   - `capturedFps` is at least 60 for every clip in `<out>/manifest.json`.
6. **Report:**
   - For each clip: its id, what it demonstrates, its beats, and the paths of `smart.mp4` and any variants.
   - If an autocap command failed or behaved unclearly, list the command, its `--json` output and the `rec doctor`
     output. This feedback shapes the next version.

Every command takes `--json`. Exit codes: 0 ok · 1 a shot or check failed · 2 setup or usage · 3 bad config or shot.

## A shot

```js
// rec/shots/notes-add.mjs
export default {
  id: "notes.add",
  title: "Add a note and watch it land",
  cam: { auto: "clicks" },
  steps: [
    { type: "Buy milk", into: "placeholder=New note", say: "Jot it down" },
    { click: 'role=button[name="Add"]', beat: "add" },
    { see: "text=Buy milk", beat: "note lands", cam: "follow" },
    { wait: 600, cam: "wide" },
  ],
};
```

Per take, `<out>/effects/<id>/` holds:
- `smart.mp4` (camera), `full.mp4` (the whole window), `focus.mp4` and `slowmo.mp4`
- `poster.png`, `timeline.json` and `captions.srt`
- `<out>/manifest.json`, which says what each clip demonstrates

## Status

0.2: the capture core is proven on a real app's 31-shot promo. Not yet built:
- cursor drawn after recording (the cursor is burned into the footage today)
- backgrounds and frames, motion blur
- audio and narration

License: MIT.
