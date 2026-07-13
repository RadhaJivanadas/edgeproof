import fs from "node:fs";

export class ReplayController {
  constructor(filePath, handlers = {}) {
    this.timeline = JSON.parse(fs.readFileSync(filePath, "utf8"));
    this.handlers = handlers;
    this.index = 0;
    this.running = false;
    this.speed = 1;
    this.timer = null;
  }

  status() {
    return {
      index: this.index,
      total: this.timeline.length,
      running: this.running,
      speed: this.speed,
      progress: this.timeline.length ? this.index / this.timeline.length : 0,
    };
  }

  start() {
    if (this.running) return;
    if (this.index >= this.timeline.length) this.index = 0;
    this.running = true;
    this.schedule(250);
  }

  pause() {
    this.running = false;
    clearTimeout(this.timer);
  }

  reset() {
    this.pause();
    this.index = 0;
    this.handlers.onReset?.();
  }

  setSpeed(speed) {
    this.speed = Math.max(0.5, Math.min(Number(speed) || 1, 8));
  }

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), Math.max(80, delay / this.speed));
  }

  async tick() {
    if (!this.running) return;
    const item = this.timeline[this.index];
    if (!item) {
      this.running = false;
      this.handlers.onEnd?.();
      return;
    }

    await this.handlers.onEvent?.(item);
    this.index += 1;
    this.handlers.onStatus?.(this.status());
    this.schedule(item.delayMs || 1100);
  }
}
