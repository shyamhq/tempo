'use client';

import * as TP from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const TooltipProvider = TP.Provider;

export function Tooltip({
  children,
  content,
  side = 'top',
}: {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <TP.Root delayDuration={150}>
      <TP.Trigger asChild>{children}</TP.Trigger>
      <TP.Portal>
        <TP.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 rounded-md border border-hairline bg-surface-3 px-2 py-1 text-xs text-ink shadow-lg',
          )}
        >
          {content}
        </TP.Content>
      </TP.Portal>
    </TP.Root>
  );
}
