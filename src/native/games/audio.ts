/**
 * Small Web Audio helpers shared by the Originals.
 *
 * Everything routes through the host's `out` node, so the platform's mute
 * works without either game knowing about it. Nothing here holds a reference
 * to `destination`, and nothing creates an AudioContext — that is the host's
 * job, and it is the only reason the games can stay this small.
 */

import type { AudioHost } from '../types';

/** A short, pitch-swept tone. The workhorse for pickups, hits and bounces. */
export function blip(
  audio: AudioHost | null,
  {
    from,
    to,
    duration = 0.12,
    type = 'square',
    gain = 0.12,
  }: {
    from: number;
    to?: number;
    duration?: number;
    type?: OscillatorType;
    gain?: number;
  },
): void {
  if (!audio) return;
  const { context, out } = audio;
  const now = context.currentTime;

  const osc = context.createOscillator();
  const level = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, now);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), now + duration);

  // A hard stop clicks; a short decay does not.
  level.gain.setValueAtTime(gain, now);
  level.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(level);
  level.connect(out);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/**
 * A held noise source — a rocket, not an event. Returned with a level that the
 * game ramps rather than restarting the source, because retriggering a noise
 * buffer sixty times a second is what makes thrust sound like static.
 */
export interface NoiseVoice {
  setLevel(value: number, rampSeconds?: number): void;
  stop(): void;
}

export function noiseVoice(
  audio: AudioHost | null,
  { cutoff = 700, gain = 0.09 }: { cutoff?: number; gain?: number } = {},
): NoiseVoice {
  if (!audio) {
    return { setLevel() {}, stop() {} };
  }
  const { context, out } = audio;

  const seconds = 1;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) channel[i] = Math.random() * 2 - 1;

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;

  const level = context.createGain();
  level.gain.value = 0;

  source.connect(filter);
  filter.connect(level);
  level.connect(out);
  source.start();

  let stopped = false;
  return {
    setLevel(value, rampSeconds = 0.05) {
      if (stopped) return;
      const target = Math.max(0, Math.min(1, value)) * gain;
      level.gain.setTargetAtTime(target, context.currentTime, Math.max(rampSeconds, 0.001));
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        source.stop();
      } catch {
        // Already stopped; nothing to clean up.
      }
      source.disconnect();
      filter.disconnect();
      level.disconnect();
    },
  };
}
