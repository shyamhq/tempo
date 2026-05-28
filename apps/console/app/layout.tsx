import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/query-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

export const metadata = {
  title: 'Tempo',
  description: 'Planning Threads for engineers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-canvas text-ink min-h-dvh">
        <QueryProvider>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
