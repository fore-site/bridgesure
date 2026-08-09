import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResolutionCenter } from '@/components/disputes/resolution-center';

export const metadata: Metadata = {
  title: 'Resolution Center',
  description:
    'Flag disputes on your trades, anchor documents as evidence, and follow the multi-sig resolution outcome.',
};

// useSearchParams (deep-linkable ?trade= / ?dispute=) requires a Suspense
// boundary above the component so the page can still prerender.
// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default page export
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="skeleton h-5 w-40" />
        </div>
      }
    >
      <ResolutionCenter />
    </Suspense>
  );
}
