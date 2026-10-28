import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { RecError } from "../config.mjs";

export const usage = "doctor                    check this machine can record, with the fix for each problem";
export const config = "optional";

const GB = 1024 ** 3;
const OS = process.platform;
const ok = (name, detail) => ({ name, ok: true, level: null, detail, fix: null });
const bad = (name, level, detail, fix) => ({ name, ok: false, level, detail, fix });
const sh = (cmd, args, timeout = 15000) => spawnSync(cmd, args, { encoding: "utf8", timeout });

function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 20 ? ok("node", `v${process.versions.node}`) : bad("node", "fail", `v${process.versions.node} is older than 20`, "install Node 20 or newer (https://nodejs.org or `nvm install 24`)");
}

async function checkChrome(cfg) {
  const exe = (cfg instanceof Error ? null : cfg?.chrome) ?? process.env.REC_CHROME;
  const fix = "run `npx playwright install chrome`, or set `chrome` in rec.config.mjs / REC_CHROME to a Chrome executable path";
  let browser;
  try {
    browser = await chromium.launch(exe ? { executablePath: exe } : { channel: "chrome" });
    return ok("chrome", `${exe ?? "channel chrome"} ${await browser.version()}`);
  } catch (e) {
    return bad("chrome", "fail", `cannot launch Chrome: ${e.message.split("\n")[0]}`, fix);
  } finally {
    await browser?.close().catch(() => {});
  }
}

function checkFfmpeg() {
  const v = sh("ffmpeg", ["-version"]);
  const install = OS === "darwin" ? "brew install ffmpeg" : OS === "win32" ? "winget install ffmpeg" : "apt-get install ffmpeg";
  if (v.error || v.status !== 0) return bad("ffmpeg", "fail", "ffmpeg is not on PATH", install);
  const enc = sh("ffmpeg", ["-hide_banner", "-encoders"]).stdout ?? "";
  const has = (n) => new RegExp(`\\s${n}\\s`).test(enc);
  if (!has("libx264")) return bad("ffmpeg", "fail", "ffmpeg has no libx264 encoder (needed for every clip)", `${install} (use a build with libx264)`);
  const warn = [];
  if (!has("libvpx-vp9")) warn.push("libvpx-vp9 (alpha .webm)");
  if (OS === "darwin" && !has("hevc_videotoolbox")) warn.push("hevc_videotoolbox (alpha .mov)");
  if (warn.length) return bad("ffmpeg", "warn", `libx264 ok; missing ${warn.join(", ")}`, `${install} (use a full build; on macOS the Homebrew one has both)`);
  return ok("ffmpeg", "libx264, libvpx-vp9" + (OS === "darwin" ? ", hevc_videotoolbox" : ""));
}

function checkRenderer(cfg) {
  const explicit = cfg instanceof Error ? null : cfg?.python;
  let py;
  if (explicit) py = [explicit];
  else if (process.env.REC_PYTHON) py = [process.env.REC_PYTHON];
  else if (sh("uv", ["--version"]).status === 0) py = ["uv", "run", "--no-project", "--quiet", "--with", "pillow", "python"];
  else py = ["python3"];
  const r = sh(py[0], [...py.slice(1), "-c", "import PIL; print(PIL.__version__)"], 120000);
  if (r.status === 0) return ok("renderer", `${py.join(" ")} (Pillow ${r.stdout.trim()})`);
  return bad("renderer", "fail", `\`${py.join(" ")}\` cannot import PIL${r.error ? `: ${r.error.message}` : ""}`, "install uv (`brew install uv` or `pip install uv`), or `pip install pillow`, or set `python` in rec.config.mjs / REC_PYTHON to an interpreter with Pillow");
}

function checkConfig(cfg) {
  if (!(cfg instanceof Error)) return ok("config", `${cfg.file} (${cfg.shots.length} shot${cfg.shots.length === 1 ? "" : "s"})`);
  if (cfg.code === 2 && /^no rec\.config\.mjs/.test(cfg.message)) return bad("config", "fail", cfg.message, "run `rec init` in the app's folder, or pass --config <file>");
  return bad("config", "fail", cfg.message, "fix rec.config.mjs as the message says, then run `rec ls` to confirm it loads");
}

async function checkApp(cfg) {
  const fix = `start the app so ${cfg.url} answers, or set \`url\` in rec.config.mjs to where it runs`;
  if (cfg.url.startsWith("file://")) {
    const path = fileURLToPath(cfg.url);
    return existsSync(path) ? ok("app", `${path} exists`) : bad("app", "fail", `${path} does not exist`, fix);
  }
  try {
    const res = await fetch(cfg.url, { signal: AbortSignal.timeout(5000) });
    if (res.status >= 500) return bad("app", "fail", `${cfg.url} answered ${res.status} (a server error)`, `fix the app so ${cfg.url} loads, then re-run doctor`);
    return ok("app", `${cfg.url} answered ${res.status}`);
  } catch (e) {
    return bad("app", "fail", `${cfg.url} did not answer within 5 s (${e.cause?.code ?? e.name})`, fix);
  }
}

function checkDisk(dir) {
  if (OS === "win32") return ok("disk", "not checked on Windows");
  let at = dir;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  const df = sh("df", ["-kP", at]);
  const free = Number(df.stdout?.trim().split("\n").pop()?.trim().split(/\s+/)[3]) * 1024;
  if (!Number.isFinite(free)) { try { const s = statfsSync(at); return diskResult(s.bavail * s.bsize, at); } catch { return ok("disk", "not checked (df failed)"); } }
  return diskResult(free, at);
}
function diskResult(free, at) {
  const detail = `${(free / GB).toFixed(1)} GB free at ${at}`;
  const fix = "free disk space (a 5 s take writes 0.2-0.4 GB of frames temporarily): empty the trash, `docker system prune`, delete old rec-assets, or set `out` to a roomier drive";
  if (free < GB) return bad("disk", "fail", `${detail}, need at least 1 GB`, fix);
  if (free < 5 * GB) return bad("disk", "warn", `${detail}, 5 GB or more is comfortable`, fix);
  return ok("disk", detail);
}

function swap() {
  if (OS === "darwin") {
    const m = sh("sysctl", ["-n", "vm.swapusage"]).stdout?.match(/total = ([\d.]+)([MGK]).*used = ([\d.]+)([MGK])/);
    if (!m) return null;
    const unit = { K: 1024, M: 1024 ** 2, G: GB };
    return { total: m[1] * unit[m[2]], used: m[3] * unit[m[4]] };
  }
  if (OS === "linux") {
    try {
      const t = readFileSync("/proc/meminfo", "utf8");
      const kb = (k) => Number(t.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1]) * 1024;
      const total = kb("SwapTotal"), free = kb("SwapFree");
      return Number.isFinite(total) && Number.isFinite(free) ? { total, used: total - free } : null;
    } catch { return null; }
  }
  return null;
}

function checkMemory() {
  const s = swap();
  if (!s) return ok("memory", "swap not checked on this OS");
  const detail = `swap ${(s.used / GB).toFixed(1)} of ${(s.total / GB).toFixed(1)} GB used`;
  if (s.used > 4 * GB || (s.total > 0 && s.used > s.total / 2)) return bad("memory", "warn", `${detail}; capture can drop to a few fps`, "restart long-running dev servers before recording (a leaking `next dev` is the usual cause)");
  return ok("memory", detail);
}

function checkLock(out) {
  const file = join(out, ".record.lock", "pid");
  if (!existsSync(file)) return ok("lock", "no take in progress");
  const pid = Number(readFileSync(file, "utf8").trim());
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === "EPERM"; }
  if (alive) return bad("lock", "warn", `another take is recording (pid ${pid})`, `wait for it to finish, or stop pid ${pid} if it is stuck`);
  return ok("lock", `stale lock (pid ${pid} is gone), will be taken over`);
}

/** What take needs before it records; any of these failing would waste the whole recording. Throws exit 2 with the fix. */
export function preflight(cfg) {
  for (const c of [checkFfmpeg(), checkRenderer(cfg), checkDisk(cfg.out)]) {
    if (!c.ok && c.level === "fail") throw new RecError(2, `${c.name}: ${c.detail}`, c.fix);
  }
}

export async function run({ cfg, flags }) {
  const loaded = cfg && !(cfg instanceof Error);
  const results = await Promise.all([
    checkNode(), checkChrome(cfg), checkFfmpeg(), checkRenderer(cfg), checkConfig(cfg),
    loaded ? checkApp(cfg) : null,
  ]);
  const out = loaded ? cfg.out : join(process.cwd(), "rec-assets");
  const checks = results.filter(Boolean);
  checks.push(checkDisk(loaded ? cfg.out : process.cwd()), checkMemory(), checkLock(out));
  const pass = !checks.some((c) => !c.ok && c.level === "fail");
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: pass, checks }) + "\n");
    return pass ? 0 : 2;
  }
  for (const c of checks) {
    const mark = c.ok ? "✓" : c.level === "warn" ? "!" : "✗";
    console.log(`${mark} ${c.name.padEnd(9)}${c.detail}`);
    if (!c.ok) console.log(`    fix: ${c.fix}`);
  }
  return pass ? 0 : 2;
}
