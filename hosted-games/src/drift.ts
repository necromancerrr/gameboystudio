/**
 * Drift, as a hosted artifact.
 *
 * Ring Out covers input, two players and phone controllers; Drift is here for
 * saves, which is the part of the adapter surface Ring Out cannot exercise
 * because it has nothing worth persisting.
 */
import createDrift from '@/native/games/drift';
import { runHostedGame } from '@gameboystudio/sdk';
import { hostNativeGame } from './nativeAdapter';

runHostedGame(hostNativeGame(createDrift));
