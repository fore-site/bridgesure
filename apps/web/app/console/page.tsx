import type { Metadata } from 'next';
import { ConsolePage } from '@/components/console/console';

export const metadata: Metadata = {
  title: 'Compliance console',
  description:
    'Fund the trade, release milestone one, freeze the exporter, and watch milestone two fail closed — then export the audit packet.',
};

// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default page export
export default function Page() {
  return <ConsolePage />;
}
