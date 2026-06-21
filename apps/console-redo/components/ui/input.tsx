import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const inputVariants = cva(
  'w-full rounded-sm border border-border-strong bg-canvas text-ink placeholder:text-ink-3 transition-[color,box-shadow] outline-none focus:border-primary focus:shadow-[var(--tp-focus-ring)] disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'py-1.5 text-sm',
        md: 'py-2 text-base',
      },
      mono: {
        true: 'font-mono',
        false: 'font-sans',
      },
    },
    defaultVariants: {
      size: 'md',
      mono: false,
    },
  },
);

type InputProps = Omit<React.ComponentProps<'input'>, 'size'> &
  VariantProps<typeof inputVariants> & {
    icon?: React.ReactNode;
  };

export function Input({ className, size, mono, icon, ...props }: InputProps) {
  return (
    <div className="relative flex w-full items-center">
      {icon ? (
        <span className="pointer-events-none absolute left-[9px] inline-flex size-[13px] text-ink-3">
          {icon}
        </span>
      ) : null}
      <input
        className={cn(
          inputVariants({ size, mono }),
          icon ? 'pl-7 pr-[11px]' : 'px-[11px]',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export { inputVariants };
