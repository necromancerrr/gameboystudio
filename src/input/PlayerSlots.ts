/**
 * Who is playing, and on what.
 *
 * `InputRouter` answers "what is player 2 holding". This answers the question
 * underneath it: "is there a player 2 at all, and what are they using?" M3 never
 * needed that — Ring Out simply ran two-player and left P2 a statue if nobody
 * arrived. A room that people join and leave needs presence to be a real thing.
 *
 * The model that survived contact with the code is NOT one device per slot.
 * `InputRouter` already merges several sources onto one player, and it should:
 * someone holding a pad can still hit Start on the keyboard. So a slot holds a
 * set of devices, and devices come in two flavours:
 *
 * - **Claiming** (gamepad, remote). A physical thing one person is holding. It
 *   takes a slot exclusively, because two pads both driving P1 in a versus game
 *   is never what anyone meant.
 * - **Shared** (keyboard, touch). Not evidence of a particular person, so it
 *   never competes for a slot; the host says which slot it feeds.
 *
 * Presence is deliberately not the same question as "can input arrive". A phone
 * has a keyboard binding attached the whole time — a Bluetooth keyboard could
 * appear at any moment — but nobody is sitting at it, so the caller decides
 * whether a keyboard counts as a person here. See NativePlayer.
 */

import type { PlayerIndex } from './InputRouter';

export type DeviceKind = 'gamepad' | 'remote' | 'keyboard' | 'touch';

export interface SlotDevice {
  kind: DeviceKind;
  /**
   * Stable identity for this device: pad index, remote peer id, keyboard scheme
   * name. Re-attaching with the same key updates in place rather than
   * duplicating, which is what makes gamepad polling idempotent.
   */
  key: string;
  /** Shown to the player. "DualSense", "Phone", "Keyboard". */
  label: string;
  /**
   * Optional second identity, used only to remember which slot this device had
   * last time. A pad's `key` must be its browser index to stay unique — two
   * DualSense pads report identical `id` strings — but the index is exactly what
   * changes when a pad sleeps and reconnects. `memo` carries the id so the
   * common case lands back where it was; when two identical pads both prefer the
   * same slot, the second simply falls through to the next free one.
   */
  memo?: string;
}

/** Devices that hold a slot exclusively, because a person is holding them. */
const CLAIMING: ReadonlySet<DeviceKind> = new Set<DeviceKind>(['gamepad', 'remote']);

export interface SlotState {
  player: PlayerIndex;
  devices: readonly SlotDevice[];
  /** True when a claiming device holds this slot. */
  claimed: boolean;
}

function deviceId(kind: DeviceKind, key: string): string {
  return `${kind}:${key}`;
}

function memoId(device: SlotDevice): string {
  return `${device.kind}:${device.memo ?? device.key}`;
}

export class PlayerSlots {
  /** `kind:key` -> the slot that device feeds. */
  private readonly placement = new Map<string, PlayerIndex>();
  /** `kind:key` -> the device itself. */
  private readonly devices = new Map<string, SlotDevice>();
  /** Keyed by `memo`. A pad that sleeps and returns lands back where it was. */
  private readonly lastSlotForMemo = new Map<string, PlayerIndex>();

  private readonly listeners = new Set<() => void>();
  private cached: readonly SlotState[] | null = null;

  constructor(readonly maxPlayers: number) {}

  /**
   * Places a device.
   *
   * Claiming devices take `preferred` when it is free, otherwise the lowest
   * unclaimed slot, and return null when every slot is spoken for. Shared
   * devices go exactly where they are told and never fail.
   *
   * A one-player game merges every claiming device onto slot 0, so whichever
   * controller someone picks up just works.
   */
  attach(device: SlotDevice, preferred?: PlayerIndex): PlayerIndex | null {
    const id = deviceId(device.kind, device.key);
    const existing = this.placement.get(id);
    if (existing !== undefined) {
      // Idempotent: gamepad polling re-attaches the same pad every frame.
      const known = this.devices.get(id);
      if (known && known.label === device.label) return existing;
      this.devices.set(id, device);
      this.changed();
      return existing;
    }

    let slot: PlayerIndex | null;
    if (!CLAIMING.has(device.kind)) {
      slot = Math.min(Math.max(preferred ?? 0, 0), this.maxPlayers - 1);
    } else if (this.maxPlayers <= 1) {
      slot = 0;
    } else {
      slot = this.freeSlot(preferred ?? this.lastSlotForMemo.get(memoId(device)));
      if (slot === null) return null;
    }

    this.placement.set(id, slot);
    this.devices.set(id, device);
    if (CLAIMING.has(device.kind)) this.lastSlotForMemo.set(memoId(device), slot);
    this.changed();
    return slot;
  }

  /** Returns the slot the device was in, or null if it was not placed. */
  detach(kind: DeviceKind, key: string): PlayerIndex | null {
    const id = deviceId(kind, key);
    const slot = this.placement.get(id);
    if (slot === undefined) return null;
    this.placement.delete(id);
    this.devices.delete(id);
    this.changed();
    return slot;
  }

  /**
   * Drops every device of a kind whose key is not in `keep`, and returns the
   * slots that lost one. The Gamepad API has no reliable disconnect event, so
   * polling has to reconcile against the list it can see.
   */
  retain(kind: DeviceKind, keep: ReadonlySet<string>): PlayerIndex[] {
    const freed: PlayerIndex[] = [];
    for (const [id, slot] of [...this.placement]) {
      const device = this.devices.get(id);
      if (!device || device.kind !== kind) continue;
      if (keep.has(device.key)) continue;
      this.placement.delete(id);
      this.devices.delete(id);
      freed.push(slot);
    }
    if (freed.length > 0) this.changed();
    return freed;
  }

  /**
   * Exchanges the occupants of two slots.
   *
   * This is why a lone controller is no longer stuck being player one. It moves
   * every device, shared ones included, so swapping in a keyboard game swaps the
   * key schemes too rather than half of them.
   */
  swap(a: PlayerIndex, b: PlayerIndex): void {
    if (a === b) return;
    let moved = false;
    for (const [id, slot] of this.placement) {
      if (slot === a) {
        this.placement.set(id, b);
        moved = true;
      } else if (slot === b) {
        this.placement.set(id, a);
        moved = true;
      }
    }
    for (const [id, slot] of this.lastSlotForMemo) {
      if (slot === a) this.lastSlotForMemo.set(id, b);
      else if (slot === b) this.lastSlotForMemo.set(id, a);
    }
    if (moved) this.changed();
  }

  slotOf(kind: DeviceKind, key: string): PlayerIndex | null {
    return this.placement.get(deviceId(kind, key)) ?? null;
  }

  /** Every slot, lowest first. Stable reference until something changes. */
  snapshot(): readonly SlotState[] {
    if (this.cached) return this.cached;
    const states: SlotState[] = [];
    for (let player = 0; player < this.maxPlayers; player += 1) {
      const devices: SlotDevice[] = [];
      for (const [id, slot] of this.placement) {
        if (slot !== player) continue;
        const device = this.devices.get(id);
        if (device) devices.push(device);
      }
      devices.sort((x, y) => x.kind.localeCompare(y.kind) || x.key.localeCompare(y.key));
      states.push({
        player,
        devices,
        claimed: devices.some((device) => CLAIMING.has(device.kind)),
      });
    }
    this.cached = states;
    return states;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private freeSlot(preferred?: PlayerIndex): PlayerIndex | null {
    const claimedSlots = new Set<PlayerIndex>();
    for (const [id, slot] of this.placement) {
      const device = this.devices.get(id);
      if (device && CLAIMING.has(device.kind)) claimedSlots.add(slot);
    }
    if (
      preferred !== undefined &&
      preferred >= 0 &&
      preferred < this.maxPlayers &&
      !claimedSlots.has(preferred)
    ) {
      return preferred;
    }
    for (let slot = 0; slot < this.maxPlayers; slot += 1) {
      if (!claimedSlots.has(slot)) return slot;
    }
    return null;
  }

  private changed(): void {
    this.cached = null;
    for (const listener of this.listeners) listener();
  }
}
