import type { Metadata } from 'next';
import { Dashboard } from '@/components/dashboard/dashboard';

export const metadata: Metadata = {
  title: 'Dashboard',
  description:
    'Balances, escrow TVL, contract alerts and upcoming milestone deadlines across your trades.',
};

// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default page export
export default function Page() {
  return <Dashboard />;
}
