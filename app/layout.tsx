import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import './globals.css';

// Rotto's own site uses a geometric sans like Montserrat.
const brand = Montserrat({ subsets: ['latin'], variable: '--font-brand' });

export const metadata: Metadata = { title: 'Rotto', description: 'Find candidates by describing them in plain English.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={brand.variable}>
      <body className="min-h-dvh font-sans text-[15px] antialiased">{children}</body>
    </html>
  );
}
