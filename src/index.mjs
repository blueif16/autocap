// Building blocks for shots and app adapters. The rec CLI (bin/rec.mjs) is the usual entry point.
export { launch, setRate, recorder, CLEAN_CSS } from "./browser.mjs";
export { encodeMp4, encodeAlpha, poster } from "./encode.mjs";
export { installStage, rule, emit } from "./stage.mjs";
export { Director } from "./director.mjs";
export { plan, path, render as renderSmart } from "./camera.mjs";
export { addToManifest, patchManifest, rebuildManifest, rel } from "./manifest.mjs";
export { loadConfig, RecError } from "./config.mjs";
