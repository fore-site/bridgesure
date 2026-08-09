import type { Metadata } from 'next';
import { AdminDisputes } from '@/components/admin/admin-disputes';

export const metadata: Metadata = {
  title: 'Dispute queue',
  description: 'Review evidence and drive multi-sig dispute resolutions.',
};

// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default page export
export default function Page() {
  return <AdminDisputes />;
}
