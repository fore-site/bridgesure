import type { Metadata } from 'next';
import { TradeDetail } from '@/components/trades/trade-detail';

export const metadata: Metadata = {
  title: 'Trade',
  description:
    'Shared trade view — the connected wallet decides whether you are the importer, the exporter, or an observer.',
};

// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default page export
export default async function Page({ params }: { params: Promise<{ tradeId: string }> }) {
  const { tradeId } = await params;
  return <TradeDetail tradeId={tradeId} />;
}
