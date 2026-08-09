/**
 * Drift — a GameBoyStudio Original.
 *
 * One star, one ship, one button that matters. You cannot brake and you cannot
 * stop: thrust and gravity are the only two forces, so every core you collect
 * is a problem you solved with momentum you already had.
 *
 * Design notes worth keeping:
 *
 * - The field is identical for every player. Cores appear in a fixed sequence
 *   at fixed places, so a good run is a good run and not a good shuffle. It
 *   also means a score is comparable to yesterday's score, which is the whole
 *   point of persisting a best.
 * - The run opens in a stable circular orbit. Doing nothing keeps you alive,
 *   which teaches gravity in about two seconds without a tutorial.
 * - There are exactly two ways to die and both are your own doing: fall into
 *   the star, or thrust hard enough to leave the field.
 */

import type { GameContext, InputSnapshot, NativeGame } from '../../types';
import { ORIGINAL_RESOLUTION, PALETTE } from '../palette';
import { blip, noiseVoice, type NoiseVoice } from '../audio';

const CENTER = { x: ORIGINAL_RESOLUTION.width / 2, y: ORIGINAL_RESOLUTION.height / 2 };

export const FIELD = {
  center: CENTER,
  /** Gravitational parameter. A circular orbit at r has speed sqrt(MU / r). */
  mu: 539_000,
  starRadius: 15,
  /** Past this the run is over — thrust is easy to overuse, and that is the point. */
  boundary: 208,
  shipRadius: 5,
  coreRadius: 7,
  pickupRadius: 14,
  startOrbit: 110,
  thrust: 150,
  turnRate: 3.1,
  maxGravity: 900,
} as const;

/** Distributes cores around the field without ever repeating a position. */
const GOLDEN_ANGLE = 2.399963229728653;
const CORE_ORBITS = [98, 134, 76, 152, 112, 88, 146] as const;

/**
 * The nth core of every run, for every player, is here. The sequence starts one
 * step in, so the first core is a flight rather than a freebie sitting on the
 * ship's starting position.
 */
export function coreAt(index: number): { x: number; y: number } {
  const angle = (index + 1) * GOLDEN_ANGLE - Math.PI / 2;
  const radius = CORE_ORBITS[index % CORE_ORBITS.length];
  return {
    x: CENTER.x + Math.cos(angle) * radius,
    y: CENTER.y + Math.sin(angle) * radius,
  };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
}

const SAVE_VERSION = 1;

/** Fixed starfield: pretty, and free of a per-frame random that would shimmer. */
function buildStars(): Star[] {
  let seed = 0x5eed;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return Array.from({ length: 70 }, () => ({
    x: random() * ORIGINAL_RESOLUTION.width,
    y: random() * ORIGINAL_RESOLUTION.height,
    size: random() < 0.15 ? 1.6 : 1,
    brightness: 0.15 + random() * 0.4,
  }));
}

class Drift implements NativeGame {
  readonly resolution = ORIGINAL_RESOLUTION;
  readonly players = { min: 1, max: 1 };

  private ctx: GameContext | null = null;
  private thrustVoice: NoiseVoice | null = null;
  private readonly stars = buildStars();

  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private angle = 0;
  private thrusting = false;

  private coreIndex = 0;
  private corePulse = 0;
  private score = 0;
  private best = 0;
  private lost = false;
  private lostFor = 0;
  private lostReason: 'star' | 'space' = 'star';
  private shake = 0;
  private elapsed = 0;

  private trail: { x: number; y: number }[] = [];
  private particles: Particle[] = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
    // init runs again on reset, so the previous voice has to go with it.
    this.thrustVoice?.stop();
    this.thrustVoice = noiseVoice(ctx.audio, { cutoff: 620, gain: 0.07 });
    this.best = 0;
    this.startRun();
  }

  private startRun(): void {
    this.x = CENTER.x;
    this.y = CENTER.y - FIELD.startOrbit;
    // Circular orbit speed, so the run opens stable instead of falling.
    this.vx = Math.sqrt(FIELD.mu / FIELD.startOrbit);
    this.vy = 0;
    this.angle = 0;
    this.thrusting = false;
    this.coreIndex = 0;
    this.score = 0;
    this.lost = false;
    this.lostFor = 0;
    this.shake = 0;
    this.elapsed = 0;
    this.trail = [];
    this.particles = [];
  }

  update(dt: number, input: InputSnapshot): void {
    this.elapsed += dt;
    this.corePulse += dt;
    this.stepParticles(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);

    const player = input.player(0);

    if (this.lost) {
      this.thrustVoice?.setLevel(0);
      this.lostFor += dt;
      // A short lockout, so the button press that killed you cannot also skip
      // the result you were about to read.
      if (this.lostFor > 0.7 && (player.pressed('a') || player.pressed('start'))) {
        this.startRun();
        blip(this.ctx?.audio ?? null, { from: 220, to: 660, duration: 0.16, type: 'triangle' });
      }
      return;
    }

    if (player.held('left')) this.angle -= FIELD.turnRate * dt;
    if (player.held('right')) this.angle += FIELD.turnRate * dt;

    this.thrusting = player.held('a') || player.held('up');
    this.thrustVoice?.setLevel(this.thrusting ? 1 : 0);

    let ax = 0;
    let ay = 0;
    if (this.thrusting) {
      ax += Math.cos(this.angle) * FIELD.thrust;
      ay += Math.sin(this.angle) * FIELD.thrust;
    }

    const dx = CENTER.x - this.x;
    const dy = CENTER.y - this.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const pull = Math.min(FIELD.mu / (distance * distance), FIELD.maxGravity);
    ax += (dx / distance) * pull;
    ay += (dy / distance) * pull;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 48) this.trail.shift();

    if (this.thrusting && Math.random() < dt * 40) {
      this.emit(
        this.x - Math.cos(this.angle) * 7,
        this.y - Math.sin(this.angle) * 7,
        1,
        PALETTE.amber,
        40,
        0.35,
      );
    }

    const core = coreAt(this.coreIndex);
    if (Math.hypot(core.x - this.x, core.y - this.y) < FIELD.pickupRadius) {
      this.collect(core);
    }

    if (distance < FIELD.starRadius + FIELD.shipRadius) this.end('star');
    else if (Math.hypot(this.x - CENTER.x, this.y - CENTER.y) > FIELD.boundary) this.end('space');
  }

  private collect(core: { x: number; y: number }): void {
    this.coreIndex += 1;
    this.score += 1;
    this.emit(core.x, core.y, 10, PALETTE.lcdDim, 90, 0.5);
    blip(this.ctx?.audio ?? null, {
      from: 660 + Math.min(this.score, 12) * 40,
      to: 1320,
      duration: 0.1,
    });
    if (this.score > this.best) {
      this.best = this.score;
      // The host owns when this is written; the game only reports the fact.
      this.ctx?.saveDirty();
    }
  }

  private end(reason: 'star' | 'space'): void {
    if (this.lost) return;
    this.lost = true;
    this.lostReason = reason;
    this.lostFor = 0;
    this.shake = 1;
    this.thrusting = false;
    this.thrustVoice?.setLevel(0);
    this.emit(this.x, this.y, 22, PALETTE.danger, 130, 0.8);
    blip(this.ctx?.audio ?? null, {
      from: 300,
      to: 40,
      duration: 0.55,
      type: 'sawtooth',
      gain: 0.16,
    });
  }

  private emit(
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    life: number,
  ): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.35 + Math.random() * 0.65);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        maxLife: life,
        color,
      });
    }
  }

  private stepParticles(dt: number): void {
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 1 - dt * 1.6;
      particle.vy *= 1 - dt * 1.6;
      particle.life -= dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = ORIGINAL_RESOLUTION;

    g.save();
    if (this.shake > 0) {
      g.translate((Math.random() - 0.5) * 6 * this.shake, (Math.random() - 0.5) * 6 * this.shake);
    }

    g.fillStyle = PALETTE.space;
    g.fillRect(-8, -8, width + 16, height + 16);

    for (const star of this.stars) {
      g.globalAlpha = star.brightness;
      g.fillStyle = PALETTE.text;
      g.fillRect(star.x, star.y, star.size, star.size);
    }
    g.globalAlpha = 1;

    // The edge of the field, drawn faintly enough to be a horizon rather than a wall.
    g.strokeStyle = PALETTE.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(CENTER.x, CENTER.y, FIELD.boundary, 0, Math.PI * 2);
    g.stroke();

    this.drawStar(g);
    if (!this.lost) this.drawCore(g);
    this.drawTrail(g);
    if (!this.lost) this.drawShip(g);
    this.drawParticles(g);

    g.restore();

    this.drawHud(g);
    if (this.lost) this.drawLost(g);
    else if (this.elapsed < 5 && this.score === 0) this.drawHint(g);
  }

  private drawStar(g: CanvasRenderingContext2D): void {
    const pulse = 1 + Math.sin(this.elapsed * 1.7) * 0.04;
    const glow = g.createRadialGradient(
      CENTER.x,
      CENTER.y,
      FIELD.starRadius * 0.4,
      CENTER.x,
      CENTER.y,
      FIELD.starRadius * 4.5,
    );
    glow.addColorStop(0, 'rgba(224, 163, 62, 0.42)');
    glow.addColorStop(1, 'rgba(224, 163, 62, 0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(CENTER.x, CENTER.y, FIELD.starRadius * 4.5, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = PALETTE.amber;
    g.beginPath();
    g.arc(CENTER.x, CENTER.y, FIELD.starRadius * pulse, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#f6d9a4';
    g.beginPath();
    g.arc(CENTER.x - 3, CENTER.y - 3, FIELD.starRadius * 0.45, 0, Math.PI * 2);
    g.fill();
  }

  private drawCore(g: CanvasRenderingContext2D): void {
    const core = coreAt(this.coreIndex);
    const pulse = 1 + Math.sin(this.corePulse * 5) * 0.16;

    g.strokeStyle = PALETTE.lcdDeep;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(core.x, core.y, FIELD.coreRadius * 1.9 * pulse, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = PALETTE.lcd;
    g.beginPath();
    g.arc(core.x, core.y, FIELD.coreRadius, 0, Math.PI * 2);
    g.fill();
  }

  private drawTrail(g: CanvasRenderingContext2D): void {
    if (this.trail.length < 2) return;
    g.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i += 1) {
      const progress = i / this.trail.length;
      g.globalAlpha = progress * 0.5;
      g.strokeStyle = PALETTE.lcdDeep;
      g.lineWidth = progress * 2.5;
      g.beginPath();
      g.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
      g.lineTo(this.trail[i].x, this.trail[i].y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  private drawShip(g: CanvasRenderingContext2D): void {
    g.save();
    g.translate(this.x, this.y);
    g.rotate(this.angle);

    if (this.thrusting) {
      const flare = 8 + Math.random() * 6;
      g.fillStyle = PALETTE.amber;
      g.beginPath();
      g.moveTo(-6, -3);
      g.lineTo(-6 - flare, 0);
      g.lineTo(-6, 3);
      g.closePath();
      g.fill();
    }

    g.fillStyle = PALETTE.text;
    g.beginPath();
    g.moveTo(9, 0);
    g.lineTo(-6, -5.5);
    g.lineTo(-3, 0);
    g.lineTo(-6, 5.5);
    g.closePath();
    g.fill();

    g.restore();
  }

  private drawParticles(g: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      g.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      g.fillStyle = particle.color;
      g.fillRect(particle.x - 1, particle.y - 1, 2.5, 2.5);
    }
    g.globalAlpha = 1;
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    g.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textBaseline = 'top';

    g.textAlign = 'left';
    g.fillStyle = PALETTE.lcd;
    g.fillText(String(this.score).padStart(2, '0'), 12, 11);

    g.textAlign = 'right';
    g.fillStyle = PALETTE.faint;
    g.fillText(`BEST ${String(this.best).padStart(2, '0')}`, ORIGINAL_RESOLUTION.width - 12, 11);
  }

  /**
   * The controls, in the game, for the first few seconds only. A game that
   * needs a manual on the page around it has not finished explaining itself.
   */
  private drawHint(g: CanvasRenderingContext2D): void {
    const { width, height } = ORIGINAL_RESOLUTION;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = '500 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillStyle = PALETTE.faint;
    g.globalAlpha = Math.min(1, (5 - this.elapsed) / 1.5);
    g.fillText('LEFT / RIGHT TO TURN   ·   A TO THRUST', width / 2, height - 22);
    g.globalAlpha = 1;
  }

  private drawLost(g: CanvasRenderingContext2D): void {
    const { width, height } = ORIGINAL_RESOLUTION;
    g.fillStyle = 'rgba(11, 12, 11, 0.72)';
    g.fillRect(0, 0, width, height);

    g.textAlign = 'center';
    g.textBaseline = 'middle';

    g.fillStyle = PALETTE.text;
    g.font = '600 20px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillText(this.lostReason === 'star' ? 'BURNED UP' : 'LOST IN SPACE', width / 2, height / 2 - 34);

    g.fillStyle = PALETTE.lcd;
    g.font = '600 34px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillText(String(this.score), width / 2, height / 2 + 4);

    g.fillStyle = PALETTE.muted;
    g.font = '500 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillText(
      this.score >= this.best && this.score > 0 ? 'NEW BEST' : `BEST ${this.best}`,
      width / 2,
      height / 2 + 34,
    );

    if (this.lostFor > 0.7) {
      g.fillStyle = PALETTE.faint;
      g.globalAlpha = 0.6 + Math.sin(this.lostFor * 5) * 0.4;
      g.fillText('PRESS A TO FLY AGAIN', width / 2, height / 2 + 62);
      g.globalAlpha = 1;
    }
  }

  serialize(): Uint8Array {
    const data = new Uint8Array(5);
    data[0] = SAVE_VERSION;
    new DataView(data.buffer).setUint32(1, this.best, true);
    return data;
  }

  restore(data: Uint8Array): void {
    if (data.length < 5 || data[0] !== SAVE_VERSION) return;
    const stored = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
    // A best score is a claim about a human; refuse an implausible one rather
    // than rendering a corrupt localStorage entry as an achievement.
    if (stored <= 9999) this.best = stored;
  }

  dispose(): void {
    this.thrustVoice?.stop();
    this.thrustVoice = null;
  }
}

export default function createDrift(): NativeGame {
  return new Drift();
}
