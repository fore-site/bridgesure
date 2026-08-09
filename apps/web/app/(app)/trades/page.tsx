import type { Metadata } from 'next';
import { TradesList } from '@/components/trades/trades-list';

export const metadata: Metadata = {
  title: 'Trades',
  description: 'Active escrows and completed deployments on the BridgeSure registry.',
};

// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default page export
export default function Page() {
  return <TradesList />;
}
