# agent-recorder

Scripted product-demo recording for coding agents: a slowed page clock captures every animation at 60 fps,
a staged backend replaces live services, and a smart camera zooms on what each shot marks.

```
npm i -D agent-recorder        # needs Google Chrome, ffmpeg, and uv or a Python with Pillow
rec ls | check | take | cut [shot-id-prefix …]
```

Each app describes itself in `rec.config.mjs` (url, viewport, staging, shots); see `src/config.mjs`.
Status: 0.1, extracted from a working promo rig. The CLI vocabulary, camera modes and skill are being built.
