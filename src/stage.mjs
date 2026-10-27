// Staging: we play the backend. One init script, installed before the app loads:
//   - fetch rules: answer matching requests with JSON or a text stream typed at a chosen speed
//   - block: write requests (by path regex) that must never reach the real server; unstaged ones get an empty success
//   - streams: URLs whose EventSource is replaced by a fake that the shot drives with emit()
//   - a visible cursor with a press dip and click ripple, driven by real mouse events (headless has no pointer)
// Timers inside the page run on the slowed clock (browser.mjs), so typing speeds stay true in the real-speed clip.
// Apps add their own helpers on top of window.__stage from an init script registered in config `prepare`.

const STAGE = (cfg) => {
  const S = (window.__stage = { rules: [], es: [] });
  const enc = new TextEncoder();

  const streamOf = (text, cps, delayMs) =>
    new ReadableStream({
      start(ctl) {
        const parts = text.match(/\S+\s*|\s+/g) ?? [];
        let i = 0;
        const next = () => {
          if (i >= parts.length) return ctl.close();
          const p = parts[i++];
          ctl.enqueue(enc.encode(p));
          setTimeout(next, (p.length / cps) * 1000);
        };
        setTimeout(next, delayMs);
      },
    });

  const BLOCK = (cfg.block ?? []).map((s) => new RegExp(s));
  const blockText = (cfg.blockText ?? []).map((s) => new RegExp(s));
  S.blocked = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    const i = S.rules.findIndex((r) => url.includes(r.url) && (r.method ?? "GET") === method && (!r.bodyIncludes || body.includes(r.bodyIncludes)));
    if (i === -1) {
      const path = new URL(url, location.href).pathname;
      if (method !== "GET" && BLOCK.some((re) => re.test(path))) {
        S.blocked.push(`${method} ${path}`);
        return blockText.some((re) => re.test(path)) ? new Response("", { headers: { "content-type": "text/plain" } }) : new Response("{}", { headers: { "content-type": "application/json" } });
      }
      return realFetch(input, init);
    }
    const r = S.rules[i];
    if (r.once) S.rules.splice(i, 1);
    if (r.kind === "stream") return new Response(streamOf(r.text, r.cps ?? 70, r.delayMs ?? 500), { headers: { "content-type": "text/plain; charset=utf-8" } });
    await new Promise((res) => setTimeout(res, r.delayMs ?? 0));
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };

  const RealES = window.EventSource;
  class FakeES extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.onopen = this.onmessage = this.onerror = null;
      S.es.push(this);
      setTimeout(() => {
        this.readyState = 1;
        const ev = new Event("open");
        this.onopen?.(ev);
        this.dispatchEvent(ev);
      }, 0);
    }
    close() {
      this.readyState = 2;
    }
  }
  window.EventSource = function (url, opts) {
    return (cfg.streams ?? []).some((p) => String(url).includes(p)) ? new FakeES(url) : new RealES(url, opts);
  };
  S.emit = (urlPart, type, data) => {
    for (const e of S.es.filter((x) => x.url.includes(urlPart))) {
      const ev = new MessageEvent(type, { data: JSON.stringify(data) });
      e.dispatchEvent(ev);
      if (type === "message") e.onmessage?.(ev);
    }
  };

  // Cursor: macOS-style arrow, follows real mouse events; press dips it and drops a ripple (WAAPI, so it slows too).
  const ensure = () => {
    let c = document.getElementById("__cursor");
    if (c || !document.body) return c;
    c = document.createElement("div");
    c.id = "__cursor";
    c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:26px;height:26px;transform:translate(-100px,-100px);display:" + (cfg.cursor ? "block" : "none");
    c.innerHTML =
      '<svg id="__arrow" width="26" height="26" viewBox="0 0 26 26" style="transform-origin:4px 3px;filter:drop-shadow(0 1.5px 2.5px rgba(0,0,0,.35))"><path d="M4.5 3 L4.5 20.5 L9 16.4 L12.2 23.4 L15.2 22.1 L12.1 15.3 L18.4 15.3 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    return c;
  };
  let x = -100, y = -100;
  const ripple = cfg.ripple ?? "65,102,235";
  addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; const c = ensure(); if (c) c.style.transform = `translate(${x - 4}px,${y - 3}px)`; }, true);
  addEventListener("mousedown", () => {
    if (!cfg.cursor) return;
    document.getElementById("__arrow")?.animate([{ transform: "scale(1)" }, { transform: "scale(.82)" }], { duration: 90, fill: "forwards", easing: "ease-out" });
    const r = document.createElement("div");
    r.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;pointer-events:none;z-index:2147483646;background:rgba(${ripple},.22);border:2px solid rgba(${ripple},.55)`;
    document.body.appendChild(r);
    r.animate([{ transform: "scale(.25)", opacity: 1 }, { transform: "scale(1.5)", opacity: 0 }], { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }).onfinish = () => r.remove();
  }, true);
  addEventListener("mouseup", () => {
    document.getElementById("__arrow")?.animate([{ transform: "scale(.82)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 220, fill: "forwards", easing: "ease-out" });
  }, true);
};

/** cfg: { cursor, streams: [urlPart], block: [pathRegex], blockText: [pathRegex answered as empty text], ripple: "r,g,b" } */
export async function installStage(page, cfg = {}) {
  await page.addInitScript(STAGE, { cursor: true, ...cfg });
}

/** Adds a fetch rule in the page: {kind:"json"|"stream", url, method, body|text, cps, delayMs, once}. */
export const rule = (page, r) => page.evaluate((r) => window.__stage.rules.push(r), r);

/** Fires one event on every fake EventSource whose URL contains `urlPart`. */
export const emit = (page, urlPart, type, data) => page.evaluate(([u, t, d]) => window.__stage.emit(u, t, d), [urlPart, type, data]);
