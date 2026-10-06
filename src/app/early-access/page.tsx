import type { Metadata } from 'next';
import { WaitlistLanding } from '@/components/WaitlistLanding';
import { getAllGames } from '@/catalog';

export const metadata: Metadata = {
  title: 'Creator early access',
  description:
    'GameDex Studio starts with your game idea. Explore the live library and experimental creation, then join the waitlist for creator updates.',
};

export default function EarlyAccessPage() {
  return <WaitlistLanding gameCount={getAllGames().length} />;
}
