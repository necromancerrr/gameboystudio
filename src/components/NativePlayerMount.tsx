'use client';

/**
 * Splits the Original player out of the route bundle.
 *
 * The game page serves both emulated and native titles, so anything it
 * imports directly ships to every Game Boy page too. A Server Component
 * dynamically importing a Client Component does not code-split (see Next's
 * lazy-loading guide), so the dynamic() call has to happen from the client
 * side of the boundary — which is all this file is.
 */

import dynamic from 'next/dynamic';
import type { NativePlayerProps } from '@/components/NativePlayer';

const NativePlayer = dynamic(
  () => import('@/components/NativePlayer').then((module) => module.NativePlayer),
  {
    ssr: false,
    loading: () => (
      <div className="flex w-full max-w-[560px] flex-col items-center">
        <div className="aspect-gb w-full rounded-xl border border-hairline bg-black" />
      </div>
    ),
  },
);

export function NativePlayerMount(props: NativePlayerProps) {
  return <NativePlayer {...props} />;
}
