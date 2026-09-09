import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://epsiflow.alexlavrin-rinok.chatgpt.site'),
  title: 'Shopify Ads Payment Infrastructure | EpsiFlow',
  description: 'EpsiFlow helps Shopify app developers in India fund Shopify Ads with a dedicated digital card, spending visibility, invoices, and direct onboarding support.',
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: 'EpsiFlow', title: 'Keep your Shopify Ads moving | EpsiFlow', description: 'Payment infrastructure for Shopify app teams in India. Fund your ads, track spending, and keep building.', url: '/' },
  twitter: { card: 'summary', title: 'Keep your Shopify Ads moving | EpsiFlow', description: 'Payment infrastructure for Shopify app teams in India.' },
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
