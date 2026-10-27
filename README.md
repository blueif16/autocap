# autocap

An agent-native Screen Studio. `autocap` records polished demo clips of a web app, driven entirely by a coding
agent. There is no MCP server: it is a CLI plus one skill. The CLI answers to `autocap` and to the short `rec`.

- **Smooth capture.** The page clock is slowed during capture, so every spring, fade and pop is caught at 60 fps.
- **Shots are steps, not code.** A fixed vocabulary of 12 verbs, validated before anything runs.
- **A camera that understands the UI.** It zooms on the elements your steps act on, including results that appear with
  no click (`see`). Styles per shot or per step: zoom on everything, clicks only or beats only; stay wide; follow;
  hold; pan; cut; zoom level; region. Any aspect: 16:9, 9:16, 1:1.
- **Staged backends.** Fake EventSource streams and fetch answers, so AI or live data plays the same every take.
- **Agents verify without watching.** `rec look` gives a contact sheet plus a per-beat framing report, and fails clips that go blank; `rec scan`
  gives a context sheet of the running app.

## For coding agents: start here

1. Install in the project root: `npm i -D github:blueif16/autocap` (needs Google Chrome, ffmpeg, and uv or a Python
   with Pillow).
2. Run `npx rec skill` and follow it. It is the whole procedure, from reading the app to the done bar and the report.
   `npx rec skill --install` keeps it for future sessions.
3. `npx rec guide` lists the vocabulary by topic; `npx rec <command> --help` shows one command.

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
