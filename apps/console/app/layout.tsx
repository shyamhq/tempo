import { GeistMono } from 'geist/font/mono';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/query-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: 'Tempo',
  description: 'Planning Threads for engineers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${GeistMono.variable}`}>
      <body className="font-sans bg-canvas text-ink min-h-dvh">
        <QueryProvider>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
