import { GbaSpike } from './GbaSpike';

/**
 * SPIKE. Not linked from anywhere, not in the catalog, not a product surface.
 * Exists to answer the questions in GBA_SPIKE.md with a running core rather
 * than with a plan.
 */
export const metadata = {
  title: 'GBA runtime spike',
  robots: { index: false, follow: false },
};

export default function GbaSpikePage() {
  return <GbaSpike />;
}
