// The Director: cursor + timeline for one take. Moves the real mouse (so hover states fire) along an eased,
// slightly arced path at 60 steps per page-second; every move, click and marked moment is logged in page time.

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Director {
  constructor(page, rate, start = { x: 1200, y: 760 }) {
    this.page = page;
    this.rate = rate;
    this.pos = { ...start };
    this.cursor = [];
    this.marks = [];
    this.events = []; // one per step of a steps shot (steps.mjs)
    this.clock = () => 0;
  }
  start(rec) {
    this.clock = () => rec.now() * this.rate;
  }
  /** Waits `ms` of page time. */
  wait(ms) {
    return new Promise((r) => setTimeout(r, ms / this.rate));
  }
  /** Names a moment; a box (CSS px) is what the smart camera frames. */
  mark(what, box, atMs = Math.round(this.clock())) {
    this.marks.push({ atMs, what, ...(box ? { box } : {}) });
  }
  async place(x, y) {
    this.pos = { x, y };
    await this.page.mouse.move(x, y);
  }
  async move(x, y, ms = 450) {
    const from = this.pos;
    const steps = Math.max(6, Math.round(ms / 16.7));
    const dx = x - from.x, dy = y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const arc = Math.min(60, len * 0.12);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = ease(t), bow = Math.sin(Math.PI * e) * arc;
      const px = from.x + dx * e + (-dy / len) * bow, py = from.y + dy * e + (dx / len) * bow;
      await this.page.mouse.move(px, py);
      this.cursor.push({ atMs: Math.round(this.clock()), x: Math.round(px), y: Math.round(py) });
      await this.wait(ms / steps);
    }
    this.pos = { x, y };
  }
  /** Box of a locator in CSS px. */
  async box(locator) {
    const b = await locator.boundingBox();
    if (!b) throw new Error("no box for locator");
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }
  /** Moves onto a locator (at fx, fy of its box) and returns the box. */
  async hover(locator, { ms = 450, fx = 0.5, fy = 0.5 } = {}) {
    const b = await this.box(locator);
    await this.move(b.x + b.w * fx, b.y + b.h * fy, ms);
    return b;
  }
  /** Presses and releases at the cursor (twice for double). */
  async press({ button = "left", double = false } = {}) {
    this.cursor.push({ atMs: Math.round(this.clock()), x: Math.round(this.pos.x), y: Math.round(this.pos.y), down: true });
    for (let n = 1; n <= (double ? 2 : 1); n++) {
      await this.page.mouse.down({ button, clickCount: n });
      await this.wait(90);
      await this.page.mouse.up({ button, clickCount: n });
    }
  }
  async click(locator, { ms = 450, fx = 0.5, fy = 0.5, dwell = 140, what } = {}) {
    const b = await this.hover(locator, { ms, fx, fy });
    await this.wait(dwell);
    this.mark(what ?? "click", b);
    this.cursor.push({ atMs: Math.round(this.clock()), x: Math.round(this.pos.x), y: Math.round(this.pos.y), down: true });
    await this.page.mouse.down();
    await this.wait(90);
    await this.page.mouse.up();
    return b;
  }
}
