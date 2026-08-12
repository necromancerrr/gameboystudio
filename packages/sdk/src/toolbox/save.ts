/**
 * A versioned save of a small number.
 *
 * All three games persist "the best you have done" and all three wrote the same
 * five lines: a version byte, a fixed-width integer, and a restore that refuses
 * anything it does not recognise. Drift and Sequence also refuse implausible
 * values, because a best score is a claim about a person and a corrupt one is
 * better ignored than displayed.
 *
 * The version byte is what stops a save written by an older build from bricking
 * a newer one (D-013's rule, in miniature).
 */

const VERSION = 1;

export interface BestScoreCodec {
  serialize(best: number): Uint8Array;
  /** Returns null when the bytes are not ours, so the caller keeps its default. */
  restore(data: Uint8Array): number | null;
}

/**
 * `max` is a plausibility bound, not a clamp: a value above it is treated as
 * corrupt and refused rather than quietly trimmed to something believable.
 */
export function bestScore(max = 0xffffffff): BestScoreCodec {
  return {
    serialize(best: number): Uint8Array {
      const bytes = new Uint8Array(5);
      bytes[0] = VERSION;
      new DataView(bytes.buffer).setUint32(1, Math.max(0, Math.floor(best)), true);
      return bytes;
    },

    restore(data: Uint8Array): number | null {
      if (data.length !== 5 || data[0] !== VERSION) return null;
      const stored = new DataView(data.buffer, data.byteOffset).getUint32(1, true);
      return stored <= max ? stored : null;
    },
  };
}
