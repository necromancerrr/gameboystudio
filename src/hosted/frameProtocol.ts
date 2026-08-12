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
 * The two button vocabularies must be the same set.
 *
 * The SDK declares its own so it can stand alone, which means nothing structural
 * stops the two lists diverging. These assignments fail to compile if they do,
 * which turns a silent drift — games decoding a button the host never sends —
 * into a build error.
 */
const _sdkButtonIsAppButton: LogicalButton = null as unknown as GbsButton;
const _appButtonIsSdkButton: GbsButton = null as unknown as LogicalButton;
void _sdkButtonIsAppButton;
void _appButtonIsSdkButton;
void GBS_BUTTONS;
