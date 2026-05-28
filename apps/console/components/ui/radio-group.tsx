'use client';

import * as RG from '@radix-ui/react-radio-group';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const RadioGroup = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof RG.Root>
>(function RadioGroup({ className, ...rest }, ref) {
  return (
    <RG.Root ref={ref} className={cn('flex flex-col gap-2', className)} {...rest} />
  );
});

export const RadioGroupItem = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof RG.Item>
>(function RadioGroupItem({ className, ...rest }, ref) {
  return (
    <RG.Item
      ref={ref}
      className={cn(
        'h-4 w-4 rounded-full border border-hairline-strong bg-surface-2 data-[state=checked]:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-focus',
        className,
      )}
      {...rest}
    >
      <RG.Indicator className="flex h-full w-full items-center justify-center after:block after:h-1.5 after:w-1.5 after:rounded-full after:bg-accent" />
    </RG.Item>
  );
});
