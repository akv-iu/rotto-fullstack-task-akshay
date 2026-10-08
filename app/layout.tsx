import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import './globals.css';

// Rotto's own site uses a geometric sans like Montserrat.
const brand = Montserrat({ subsets: ['latin'], variable: '--font-brand' });

export const metadata: Metadata = { title: 'Rotto', description: 'Find candidates by describing them in plain English.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below may set data-theme before React loads.
    <html lang="en" className={brand.variable} suppressHydrationWarning>
      <head>
        {/* Apply a saved light/dark choice before the first paint, so the page never flashes the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}" }} />
      </head>
      <body className="min-h-dvh font-sans text-[15px] antialiased">{children}</body>
    </html>
  );
}
