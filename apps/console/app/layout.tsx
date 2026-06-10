import {ClerkProvider} from '@clerk/nextjs';
import { GeistMono } from 'geist/font/mono';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/query-provider';
import { Sidebar } from '@/components/sidebar/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { listSpaces } from '@/server/spaces';
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

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const spaces = await listSpaces();
  return (
    <html lang="en" className={`${inter.variable} ${GeistMono.variable}`}>
      <body className="font-sans bg-canvas text-ink min-h-dvh">
        <ClerkProvider>
          <QueryProvider>
          <TooltipProvider delayDuration={150}>
          <div className="flex h-dvh">
          <Sidebar initial={spaces} />
          <div className="flex-1 min-w-0 overflow-auto">{children}</div>
          </div>
          </TooltipProvider>
          </QueryProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}