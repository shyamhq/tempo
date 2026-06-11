import { ClerkProvider } from '@clerk/nextjs';
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

// Root layout is providers + html/body only. The app shell (sidebar, settings
// modal, workspace fetches) lives in `(app)/layout.tsx`; auth and onboarding
// share `(auth)/layout.tsx`. Splitting like this means signed-out pages don't
// have to swallow workspace-lookup errors from the root.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${GeistMono.variable}`}>
      <body className="font-sans bg-canvas text-ink min-h-dvh">
        <ClerkProvider>
          <QueryProvider>
            <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
          </QueryProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
