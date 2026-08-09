/**
 * The native runtime's own frame loop.
 *
 * This deliberately duplicates roughly forty lines of requestAnimationFrame
 * and delta-clamping logic that also exist inside BinjgbAdapter. Extracting a
 * shared loop would mean reopening the 466 lines that carry every hard-won
 * emulation fix in this project, and the loop interleaves with them. See
 * M3_PLAN.md — duplication is the cheaper risk. If the two loops prove
 * identical in practice, converging them later is a boring refactor.
 *
 * The scheduler is injectable so the loop can be driven deterministically by a
 * test harness instead of by a real browser frame clock.
 */

export interface Scheduler {
  /** Milliseconds, monotonic. */
  now(): number;
  requestFrame(callback: (timestamp: number) => void): number;
  cancelFrame(handle: number): void;
}

/**
 * A frame longer than this is a stall — a backgrounded tab, a long GC, a
 * breakpoint — not slow gameplay. Passing the real delta through would
 * teleport everything moving; clamping makes the game skip time instead.
 */
export const MAX_DELTA_SECONDS = 0.25;

export function browserScheduler(): Scheduler {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  };
}

export class GameLoop {
  private handle: number | null = null;
  private active = false;
  private last = 0;

  constructor(
    private readonly tick: (dt: number) => void,
    private readonly scheduler: Scheduler,
  ) {}

  get running(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    // The clock resets on every start, so time spent paused is not handed to
    // the game as one enormous frame when it resumes.
    this.last = this.scheduler.now();
    this.schedule();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.handle !== null) {
      this.scheduler.cancelFrame(this.handle);
      this.handle = null;
    }
  }

  private schedule(): void {
    this.handle = this.scheduler.requestFrame((timestamp) => {
      this.handle = null;
      const dt = Math.min((timestamp - this.last) / 1000, MAX_DELTA_SECONDS);
      this.last = timestamp;
      // Two callbacks can land on the same timestamp; there is nothing to
      // simulate, but the next frame is still scheduled.
      if (dt > 0) this.tick(dt);
      // Checked after the tick, so a tick that stops the loop — a fatal game
      // error, a teardown — is not immediately rescheduled.
      if (this.active) this.schedule();
    });
  }
}
