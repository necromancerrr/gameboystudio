import type { Metadata } from 'next';
import { WaitlistLanding } from '@/components/WaitlistLanding';
import { getAllGames } from '@/catalog';

export const metadata: Metadata = {
  title: 'Early access',
  description:
    'GameBoyStudio is becoming a console for the browser. Join the waitlist for original games, shared screens, and what comes next.',
};

export default function EarlyAccessPage() {
  return <WaitlistLanding gameCount={getAllGames().length} />;
}
