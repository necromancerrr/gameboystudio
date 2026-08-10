import { Suspense } from 'react';
import type { Metadata } from 'next';
import { JoinController } from '@/components/JoinController';

export const metadata: Metadata = {
  title: 'Join a game — GameBoyStudio',
  description: 'Turn this device into a controller for a game on another screen.',
  // A controller page has nothing to offer a search engine, and a room code in
  // an index would be a capability sitting in public.
  robots: { index: false, follow: false },
};

export default function JoinPage() {
  // useSearchParams needs a boundary for this page to stay statically rendered.
  return (
    <Suspense fallback={null}>
      <JoinController />
    </Suspense>
  );
}
