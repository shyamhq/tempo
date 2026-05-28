import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'block w-full rounded-md border border-hairline bg-surface-2 text-ink placeholder:text-ink-tertiary h-8 px-3 text-sm focus-visible:outline-none focus-visible:border-accent-focus focus-visible:ring-1 focus-visible:ring-accent-focus',
          className,
        )}
        {...rest}
      />
    );
  },
);
