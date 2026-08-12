/**
 * Randomness, seedable.
 *
 * All three games called `Math.random` directly, which is fine until something
 * needs to be reproduced — a bug report, a test, or a generated game that
 * should look the same twice while it is being checked. The default is still
 * unseeded, so nothing changes for a game that does not care.
 *
 * mulberry32: small, fast, good enough for picking a panel or a spawn point,
 * and emphatically not for anything cryptographic.
 */
export class Random {
  private state: number;
  private readonly seeded: boolean;

  constructor(seed?: number) {
    this.seeded = seed !== undefined;
    this.state = (seed ?? 0) >>> 0;
  }

  /** [0, 1) */
  next(): number {
    if (!this.seeded) return Math.random();
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  /** True with probability `chance`. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }
}
