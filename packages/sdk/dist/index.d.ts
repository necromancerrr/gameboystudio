/**
 * The SDK a hosted game is built against.
 *
 * This is a published contract, not an engine. It forwards lifecycle and input
 * and does nothing else — no rendering, no physics, no asset loading, no
 * opinions about how a game is written. That restraint is the point: D-018 says
 * a new verb needs a real game that needs it, or this becomes an engine by
 * accretion.
 *
 * A hosted game supplies the same three methods a native game does, so the two
 * are the same shape from the author's side even though one is compiled into
 * the site and the other is not.
 *
 * This file is bundled into the hosted artifact, not into the application. It
 * is installed from a tarball (D-020), so nothing here may reach back into the
 * GameBoyStudio source — a package that did would not be installable anywhere.
 */
import { type GbsButton } from './protocol.js';
export * from './protocol.js';
export interface HostedInput {
    held(player: number, button: GbsButton): boolean;
    /** True on exactly one frame per press, so a tap is never swallowed. */
    pressed(player: number, button: GbsButton): boolean;
}
export interface HostedGameContext {
    players: number;
    canvas: HTMLCanvasElement;
    /**
     * Report that persistent state changed. The host decides when to actually
     * serialize and where the bytes go — the same division the native contract
     * uses, so a game written for one reads the same as a game written for the
     * other.
     */
    saveDirty(): void;
}
export interface HostedGameDefinition {
    readonly width: number;
    readonly height: number;
    init(context: HostedGameContext): void | Promise<void>;
    update(dt: number, input: HostedInput): void;
    render(g: CanvasRenderingContext2D): void;
    /** Opt into saves. A game without these simply has no save. */
    serialize?(): Uint8Array;
    restore?(data: Uint8Array): void;
    dispose?(): void;
}
/**
 * Connects a game to the host and runs it.
 *
 * Everything about the surrounding page — the canvas, the loop, mute, pause —
 * is handled here so a hosted game is no harder to write than a compiled one.
 */
export declare function runHostedGame(game: HostedGameDefinition): void;
