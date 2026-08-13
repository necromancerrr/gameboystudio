/**
 * The frame protocol, re-exported from the SDK package.
 *
 * The definition lives in `packages/sdk` because the SDK is the authoring
 * boundary (D-020): a game is built against the package, so the package has to
 * own the contract. The application imports it from there, which is what stops
 * host and guest drifting apart — there is one definition, not two that have to
 * be kept equal by hand.
 *
 * This file exists so the rest of the application keeps its familiar import
 * path, and as the one place where the SDK's button vocabulary is checked
 * against ours.
 */

import type { LogicalButton } from '@/emulation/core/types';
import { GBS_BUTTONS, type GbsButton } from '@gameboystudio/sdk';

export * from '@gameboystudio/sdk';

/**
 * Every SDK button must be a platform button.
 *
 * This used to assert the two vocabularies were the same set, in both
 * directions. Game Boy Advance broke that: the platform gained L and R, and the
 * SDK did not. Widening the SDK's Button would be a protocol change (D-021) and
 * a lie besides — a game authored against the eight-button model has no meaning
 * for a shoulder press.
 *
 * So the invariant is now one-directional, and `toGbsButton` below is the
 * narrowing every send site has to go through. Drift in the other direction —
 * the SDK declaring a button the platform cannot produce — still fails to
 * compile, which is the direction that would break games.
 */
const _sdkButtonIsAppButton: LogicalButton = null as unknown as GbsButton;
void _sdkButtonIsAppButton;
void GBS_BUTTONS;

/**
 * Narrows a platform button to the SDK vocabulary, or null if the SDK has no
 * such button. Hosted and native games are authored against eight buttons;
 * shoulders are dropped here rather than at every call site.
 */
export function toGbsButton(button: LogicalButton): GbsButton | null {
  return (GBS_BUTTONS as readonly string[]).includes(button)
    ? (button as GbsButton)
    : null;
}
