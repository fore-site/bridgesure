import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://bridgesure.cleanverse.dev'),
  title: {
    default: 'BridgeSure - Compliance-continuous escrow on Monad',
    template: '%s · BridgeSure',
  },
  description:
    'The escrow that re-verifies both parties before every release. Milestone payments move only after fresh Cleanverse A-Pass and validator checks, with every decision reason-coded on-chain and exportable as Travel Rule evidence.',
  openGraph: {
    title: 'BridgeSure - Compliance-continuous escrow on Monad',
    description:
      'Milestone payments move only after fresh Cleanverse checks on both parties. A stale credential blocks the next release. Funds stay put.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#060a11',
  colorScheme: 'dark',
};

// eslint-disable-next-line no-restricted-syntax -- Next.js App Router requires a default layout export
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
