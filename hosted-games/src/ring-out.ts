/**
 * Ring Out, as a hosted artifact.
 *
 * The game itself is imported unmodified. That is the whole value of using it
 * as the control: if hosted Ring Out behaves differently from compiled Ring
 * Out, the difference is the hosting and nothing else.
 */
import createRingOut from '@/native/games/ring-out';
import { runHostedGame } from '@gameboystudio/sdk';
import { hostNativeGame } from './nativeAdapter';

runHostedGame(hostNativeGame(createRingOut));
