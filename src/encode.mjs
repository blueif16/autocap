// Frames → clips. Each frame lasts its page-time duration, so the clip plays at real speed whatever the capture fps.
import { writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** A path quoted for an ffconcat `file` line: inside single quotes, a ' is written '\''. */
const quote = (p) => `'${p.replaceAll("'", "'\\''")}'`;

/** Writes an ffmpeg concat list where each frame lasts its page-time duration × stretch. */
function concatList(frames, rate, stretch, listPath) {
  let s = "";
  frames.forEach((f, i) => {
    const next = frames[i + 1]?.wall ?? f.wall + 1000 / 30;
    s += `file ${quote(f.file)}\nduration ${(((next - f.wall) * rate * stretch) / 1000).toFixed(6)}\n`;
  });
  s += `file ${quote(frames[frames.length - 1].file)}\n`;
  writeFileSync(listPath, s);
}

function ff(args) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
}

const EVEN = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

/** Opaque clip: H.264 60 fps, high quality, plays everywhere. crop is in device px. */
export function encodeMp4(frames, out, { rate, stretch = 1, crop } = {}) {
  const list = out + ".txt";
  concatList(frames, rate, stretch, list);
  const vf = [crop && `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, "fps=60", EVEN, "format=yuv420p"].filter(Boolean).join(",");
  ff(["-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-movflags", "+faststart", out]);
  rmSync(list);
}

/**
 * Transparent clip: HEVC-with-alpha .mov (Final Cut, Premiere/DaVinci on Mac, Safari, QuickTime) + VP9 .webm
 * with alpha (Chrome, Remotion, HyperFrames). ProRes 4444 was 30× larger (160 MB per 4 s at 1024²), so it's out.
 */
export function encodeAlpha(frames, base, { rate, stretch = 1 } = {}) {
  const list = base + ".txt";
  concatList(frames, rate, stretch, list);
  ff(["-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=60,${EVEN},format=bgra`, "-c:v", "hevc_videotoolbox", "-alpha_quality", "0.9", "-q:v", "70", "-tag:v", "hvc1", base + ".mov"]);
  ff(["-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=60,${EVEN},format=yuva420p`, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "22", "-row-mt", "1", "-auto-alt-ref", "0", base + ".webm"]);
  rmSync(list);
}

export function poster(frameFile, out, crop) {
  ff(["-i", frameFile, ...(crop ? ["-vf", `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : []), "-frames:v", "1", "-update", "1", out]);
}
