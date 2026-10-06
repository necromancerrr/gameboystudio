import type { Metadata } from 'next';
import { getAllGames } from '@/catalog';
import { WaitlistLanding } from './WaitlistLanding';

export const betaMetadata: Metadata = {
  title: 'Beta early access',
  description: 'GameDex Studio is in beta, ahead of its full launch. Explore the playable game library and see what is coming next. Public AI creation is not available yet.',
};

/** One source of truth for the public homepage and the early-access URL. */
export function BetaLandingPage() {
  return <WaitlistLanding gameCount={getAllGames().length} signupEnabled={Boolean(process.env.GBS_WAITLIST_ENDPOINT?.trim())} />;
}
