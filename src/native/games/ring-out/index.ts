/**
 * Ring Out — a GameBoyStudio Original for two people on one screen.
 *
 * Top-down sumo. Move, dash, shove the other player off a platform that keeps
 * shrinking. One sentence of rules, rounds of about fifteen seconds, and a
 * rematch that costs one button press.
 *
 * The comedy is physics, not content: the floor is slippery, dashes are
 * committed, and the ring gets smaller whether or not anyone is winning. That
 * is deliberate — a two-player game nobody has to explain is the whole point,
 * and it is what makes "wait, plug your controller in" a sentence someone says
 * out loud.
 *
 * No serialize/restore: there is nothing here worth persisting, and the
 * contract says a game without them simply has no save.
 */

import type { GameContext, InputSnapshot, NativeGame } from '../../types';
import { ORIGINAL_RESOLUTION, PALETTE } from '../palette';
import { blip } from '../audio';

const CENTER = { x: ORIGINAL_RESOLUTION.width / 2, y: ORIGINAL_RESOLUTION.height / 2 };

const ARENA = {
  startRadius: 120,
  /** The ring keeps closing past this, so no round can stall forever. */
  endRadius: 46,
  shrinkSeconds: 15,
} as const;

const FIGHTER = {
  radius: 13,
  accel: 520,
  friction: 1.5,
  maxSpeed: 190,
  dashSpeed: 330,
  dashSeconds: 0.16,
  dashCooldown: 0.85,
  /** A landed dash hits harder than a drift into someone. */
  dashPunch: 2.3,
  restitution: 1.35,
} as const;

const ROUNDS_TO_WIN = 3;

interface Fighter {
  player: number;
  color: string;
  deepColor: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingX: number;
  facingY: number;
  dashFor: number;
  cooldown: number;
  out: boolean;
  wins: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

type Phase = 'ready' | 'fight' | 'scored' | 'match';

function makeFighter(player: number): Fighter {
  const isP1 = player === 0;
  return {
    player,
    color: isP1 ? PALETTE.lcd : PALETTE.amber,
    deepColor: isP1 ? PALETTE.lcdDeep : PALETTE.amberDeep,
    label: isP1 ? 'P1' : 'P2',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facingX: isP1 ? 1 : -1,
    facingY: 0,
    dashFor: 0,
    cooldown: 0,
    out: false,
    wins: 0,
  };
}

class RingOut implements NativeGame {
  readonly resolution = ORIGINAL_RESOLUTION;
  readonly players = { min: 2, max: 2 };

  private ctx: GameContext | null = null;
  private fighters: Fighter[] = [];
  private sparks: Spark[] = [];

  private phase: Phase = 'ready';
  private phaseFor = 0;
  private roundFor = 0;
  private radius: number = ARENA.startRadius;
  private lastWinner: Fighter | null = null;
  private elapsed = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.fighters = [makeFighter(0), makeFighter(1)];
    this.sparks = [];
    this.lastWinner = null;
    this.elapsed = 0;
    this.startRound();
  }

  private startRound(): void {
    this.phase = 'ready';
    this.phaseFor = 0;
    this.roundFor = 0;
    this.radius = ARENA.startRadius;
    for (const fighter of this.fighters) {
      const side = fighter.player === 0 ? -1 : 1;
      fighter.x = CENTER.x + side * 58;
      fighter.y = CENTER.y;
      fighter.vx = 0;
      fighter.vy = 0;
      fighter.facingX = -side;
      fighter.facingY = 0;
      fighter.dashFor = 0;
      fighter.cooldown = 0;
      fighter.out = false;
    }
  }

  update(dt: number, input: InputSnapshot): void {
    this.elapsed += dt;
    this.phaseFor += dt;
    this.stepSparks(dt);

    if (this.phase === 'ready') {
      if (this.phaseFor > 0.9) {
        this.phase = 'fight';
        this.phaseFor = 0;
        blip(this.ctx?.audio ?? null, { from: 520, to: 780, duration: 0.12, type: 'triangle' });
      }
      return;
    }

    if (this.phase === 'scored') {
      if (this.phaseFor > 1.3) this.startRound();
      return;
    }

    if (this.phase === 'match') {
      // Either player can call the rematch. Handing that to player one only
      // would make the loser wait for permission.
      const rematch = this.fighters.some(
        (fighter) =>
          input.player(fighter.player).pressed('a') ||
          input.player(fighter.player).pressed('start'),
      );
      if (this.phaseFor > 0.8 && rematch) {
        for (const fighter of this.fighters) fighter.wins = 0;
        this.lastWinner = null;
        this.startRound();
      }
      return;
    }

    this.roundFor += dt;
    const shrink = Math.min(this.roundFor / ARENA.shrinkSeconds, 1);
    this.radius = ARENA.startRadius + (ARENA.endRadius - ARENA.startRadius) * shrink;
    // Past the shrink window the ring keeps closing slowly, so a stalemate
    // still resolves rather than lasting forever.
    if (shrink >= 1) this.radius = Math.max(18, ARENA.endRadius - (this.roundFor - ARENA.shrinkSeconds) * 4);

    for (const fighter of this.fighters) this.driveFighter(fighter, dt, input);
    this.collide();

    // The ring can close onto both fighters in the same frame. Whoever is
    // further out loses, rather than whoever happens to be checked first.
    const outside = this.fighters
      .filter((fighter) => !fighter.out)
      .map((fighter) => ({
        fighter,
        distance: Math.hypot(fighter.x - CENTER.x, fighter.y - CENTER.y),
      }))
      .filter((entry) => entry.distance > this.radius)
      .sort((a, b) => b.distance - a.distance);

    if (outside.length > 0) this.knockOut(outside[0].fighter);
  }

  private driveFighter(fighter: Fighter, dt: number, input: InputSnapshot): void {
    const pad = input.player(fighter.player);

    let dx = 0;
    let dy = 0;
    if (pad.held('left')) dx -= 1;
    if (pad.held('right')) dx += 1;
    if (pad.held('up')) dy -= 1;
    if (pad.held('down')) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;
      fighter.facingX = dx;
      fighter.facingY = dy;
    }

    fighter.cooldown = Math.max(0, fighter.cooldown - dt);
    if (fighter.dashFor > 0) fighter.dashFor = Math.max(0, fighter.dashFor - dt);

    if (pad.pressed('a') && fighter.cooldown === 0) {
      fighter.dashFor = FIGHTER.dashSeconds;
      fighter.cooldown = FIGHTER.dashCooldown;
      fighter.vx = fighter.facingX * FIGHTER.dashSpeed;
      fighter.vy = fighter.facingY * FIGHTER.dashSpeed;
      blip(this.ctx?.audio ?? null, { from: 180, to: 90, duration: 0.1, type: 'sawtooth', gain: 0.08 });
    } else if (fighter.dashFor === 0) {
      fighter.vx += dx * FIGHTER.accel * dt;
      fighter.vy += dy * FIGHTER.accel * dt;
    }

    // Slippery on purpose: momentum is what makes a shove land or miss.
    const damping = Math.max(0, 1 - FIGHTER.friction * dt);
    fighter.vx *= damping;
    fighter.vy *= damping;

    const speed = Math.hypot(fighter.vx, fighter.vy);
    const limit = fighter.dashFor > 0 ? FIGHTER.dashSpeed : FIGHTER.maxSpeed;
    if (speed > limit) {
      fighter.vx = (fighter.vx / speed) * limit;
      fighter.vy = (fighter.vy / speed) * limit;
    }

    fighter.x += fighter.vx * dt;
    fighter.y += fighter.vy * dt;
  }

  private collide(): void {
    const [a, b] = this.fighters;
    if (!a || !b || a.out || b.out) return;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const minimum = FIGHTER.radius * 2;
    if (distance === 0 || distance >= minimum) return;

    const nx = dx / distance;
    const ny = dy / distance;

    // Separate first, or the pair sticks together and shoves stop reading.
    const overlap = (minimum - distance) / 2;
    a.x -= nx * overlap;
    a.y -= ny * overlap;
    b.x += nx * overlap;
    b.y += ny * overlap;

    const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (relative > 0) return;

    const punch = (a.dashFor > 0 ? FIGHTER.dashPunch : 1) * (b.dashFor > 0 ? FIGHTER.dashPunch : 1);
    const impulse = -(1 + FIGHTER.restitution) * relative * 0.5 * punch;
    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    b.vx += impulse * nx;
    b.vy += impulse * ny;

    const hitX = a.x + nx * FIGHTER.radius;
    const hitY = a.y + ny * FIGHTER.radius;
    this.emit(hitX, hitY, 6 + Math.min(10, Math.round(impulse / 40)), PALETTE.text, 120, 0.32);
    blip(this.ctx?.audio ?? null, {
      from: 320 + Math.min(impulse, 400),
      to: 140,
      duration: 0.09,
      gain: Math.min(0.16, 0.05 + impulse / 3000),
    });
  }

  private knockOut(loser: Fighter): void {
    loser.out = true;
    const winner = this.fighters.find((fighter) => fighter !== loser) ?? null;
    if (winner) winner.wins += 1;
    this.lastWinner = winner;
    this.emit(loser.x, loser.y, 18, loser.color, 150, 0.6);
    blip(this.ctx?.audio ?? null, { from: 260, to: 50, duration: 0.5, type: 'sawtooth', gain: 0.15 });

    this.phaseFor = 0;
    this.phase = winner && winner.wins >= ROUNDS_TO_WIN ? 'match' : 'scored';
  }

  private emit(x: number, y: number, count: number, color: string, speed: number, life: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.3 + Math.random() * 0.7);
      this.sparks.push({
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

  private stepSparks(dt: number): void {
    for (const spark of this.sparks) {
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vx *= 1 - dt * 2.4;
      spark.vy *= 1 - dt * 2.4;
      spark.life -= dt;
    }
    this.sparks = this.sparks.filter((spark) => spark.life > 0);
  }

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = ORIGINAL_RESOLUTION;

    g.fillStyle = PALETTE.space;
    g.fillRect(0, 0, width, height);

    this.drawArena(g);

    for (const fighter of this.fighters) {
      if (!fighter.out) this.drawFighter(g, fighter);
    }

    for (const spark of this.sparks) {
      g.globalAlpha = Math.max(0, spark.life / spark.maxLife);
      g.fillStyle = spark.color;
      g.fillRect(spark.x - 1, spark.y - 1, 2.5, 2.5);
    }
    g.globalAlpha = 1;

    this.drawScore(g);
    this.drawBanner(g);
  }

  private drawArena(g: CanvasRenderingContext2D): void {
    g.fillStyle = PALETTE.grid;
    g.beginPath();
    g.arc(CENTER.x, CENTER.y, this.radius, 0, Math.PI * 2);
    g.fill();

    // A warning rim once the ring is genuinely tight.
    const danger = this.radius < 70;
    g.strokeStyle = danger ? PALETTE.danger : PALETTE.hairline;
    g.lineWidth = danger ? 2 : 1.5;
    g.beginPath();
    g.arc(CENTER.x, CENTER.y, this.radius, 0, Math.PI * 2);
    g.stroke();

    g.strokeStyle = PALETTE.hairline;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(CENTER.x, CENTER.y, Math.max(6, this.radius * 0.35), 0, Math.PI * 2);
    g.stroke();
  }

  private drawFighter(g: CanvasRenderingContext2D, fighter: Fighter): void {
    if (fighter.dashFor > 0) {
      g.globalAlpha = 0.35;
      g.fillStyle = fighter.deepColor;
      g.beginPath();
      g.arc(
        fighter.x - fighter.facingX * 10,
        fighter.y - fighter.facingY * 10,
        FIGHTER.radius,
        0,
        Math.PI * 2,
      );
      g.fill();
      g.globalAlpha = 1;
    }

    g.fillStyle = fighter.color;
    g.beginPath();
    g.arc(fighter.x, fighter.y, FIGHTER.radius, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = PALETTE.space;
    g.beginPath();
    g.arc(
      fighter.x + fighter.facingX * 5,
      fighter.y + fighter.facingY * 5,
      4,
      0,
      Math.PI * 2,
    );
    g.fill();

    // Cooldown ring: the only thing a player needs to know that the body
    // cannot show on its own.
    if (fighter.cooldown > 0) {
      const remaining = fighter.cooldown / FIGHTER.dashCooldown;
      g.strokeStyle = fighter.deepColor;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(
        fighter.x,
        fighter.y,
        FIGHTER.radius + 3.5,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * (1 - remaining),
      );
      g.stroke();
    }
  }

  private drawScore(g: CanvasRenderingContext2D): void {
    const { width } = ORIGINAL_RESOLUTION;
    g.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textBaseline = 'top';

    for (const fighter of this.fighters) {
      const left = fighter.player === 0;
      g.textAlign = left ? 'left' : 'right';
      g.fillStyle = fighter.color;
      g.fillText(fighter.label, left ? 14 : width - 14, 12);

      for (let i = 0; i < ROUNDS_TO_WIN; i += 1) {
        const x = left ? 44 + i * 12 : width - 44 - i * 12;
        g.fillStyle = i < fighter.wins ? fighter.color : PALETTE.hairline;
        g.beginPath();
        g.arc(x, 18, 4, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private drawBanner(g: CanvasRenderingContext2D): void {
    const { width, height } = ORIGINAL_RESOLUTION;
    if (this.phase === 'fight') return;

    g.textAlign = 'center';
    g.textBaseline = 'middle';

    if (this.phase === 'ready') {
      g.fillStyle = PALETTE.text;
      g.font = '600 22px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.fillText('READY', width / 2, height / 2 - 6);
      g.fillStyle = PALETTE.faint;
      g.font = '500 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.fillText('MOVE TO SHOVE  ·  A TO DASH', width / 2, height / 2 + 22);
      return;
    }

    g.fillStyle = 'rgba(11, 12, 11, 0.68)';
    g.fillRect(0, 0, width, height);

    const winner = this.lastWinner;
    g.fillStyle = winner ? winner.color : PALETTE.text;
    g.font = '600 26px ui-monospace, SFMono-Regular, Menlo, monospace';

    if (this.phase === 'scored') {
      g.fillText(`${winner?.label ?? 'NOBODY'} SCORES`, width / 2, height / 2);
      return;
    }

    g.fillText(`${winner?.label ?? 'NOBODY'} WINS`, width / 2, height / 2 - 14);
    if (this.phaseFor > 0.8) {
      g.fillStyle = PALETTE.muted;
      g.font = '500 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.globalAlpha = 0.6 + Math.sin(this.phaseFor * 5) * 0.4;
      g.fillText('PRESS A TO REMATCH', width / 2, height / 2 + 24);
      g.globalAlpha = 1;
    }
  }
}

export default function createRingOut(): NativeGame {
  return new RingOut();
}
