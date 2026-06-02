import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Agent Identity & Auth Patterns',
  description:
    'Provider-agnostic framework for AI agents acting on behalf of users with precise credential routing.',
  icons: {
    icon: '/logo.svg',
    shortcut: '/logo.svg',
    apple: '/logo.svg',
  },
  openGraph: {
    title: 'Agent Identity & Auth Patterns — by Datacules LLC',
    description:
      'Provider-agnostic framework for AI agents acting on behalf of users with precise credential routing.',
    images: [
      {
        url: '/logo.svg',
        width: 640,
        height: 240,
        alt: 'Agent Identity — by Datacules LLC',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
