'use client';

import * as CB from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Checkbox = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof CB.Root>
>(function Checkbox({ className, ...rest }, ref) {
  return (
    <CB.Root
      ref={ref}
      className={cn(
        'h-4 w-4 rounded border border-hairline-strong bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-focus',
        className,
      )}
      {...rest}
    >
      <CB.Indicator className="flex h-full w-full items-center justify-center text-on-accent">
        <Check className="h-3 w-3" />
      </CB.Indicator>
    </CB.Root>
  );
});
