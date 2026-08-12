/**
 * A phase with a clock.
 *
 * All three games wrote this: a `phase` string, a `phaseFor` accumulator, and
 * an `elapsed` total, advanced by hand every frame. Drift used it for lost/
 * restarting, Ring Out for ready/fight/scored/match, Sequence for
 * idle/showing/repeating/wrong/over. Same shape, three times, three sets of
 * off-by-one risks around when the clock resets.
 *
 * The clock resets on entering a phase and not otherwise, which is the part
 * that was easiest to get subtly wrong by hand.
 */
export class Phases<P extends string> {
  private current: P;
  private since = 0;
  private total = 0;
  private entered = true;

  constructor(initial: P) {
    this.current = initial;
  }

  /** Call once per frame, before reading anything else. */
  advance(dt: number): void {
    this.since += dt;
    this.total += dt;
    this.entered = false;
  }

  get phase(): P {
    return this.current;
  }

  /** Seconds since this phase began. */
  get phaseFor(): number {
    return this.since;
  }

  /** Seconds since the game began, across all phases. */
  get elapsed(): number {
    return this.total;
  }

  /** True on the first frame of a phase, so entry effects fire exactly once. */
  get justEntered(): boolean {
    return this.entered;
  }

  is(...phases: P[]): boolean {
    return phases.includes(this.current);
  }

  /** Moving to the phase you are already in still restarts its clock. */
  to(phase: P): void {
    this.current = phase;
    this.since = 0;
    this.entered = true;
  }

  /** `to(next)` once this phase has lasted `seconds`. Returns whether it moved. */
  after(seconds: number, next: P): boolean {
    if (this.since < seconds) return false;
    this.to(next);
    return true;
  }

  /** Restarts everything, for a game that is being played again. */
  reset(phase: P): void {
    this.to(phase);
    this.total = 0;
  }
}
