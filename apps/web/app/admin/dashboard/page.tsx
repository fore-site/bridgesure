import type { Metadata } from 'next';
import { AdminDashboard } from '@/components/admin/admin-dashboard';

export const metadata: Metadata = {
  title: 'Operator dashboard',
  description: 'Registry health, escrow TVL, and the operator action flow for every trade.',
};

// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default page export
export default function Page() {
  return <AdminDashboard />;
}
