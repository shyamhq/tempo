import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const iconButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-sm border border-transparent transition-colors outline-none focus-visible:shadow-[var(--tp-focus-ring)] disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      size: {
        sm: 'size-[26px] [&_svg]:size-[14px]',
        md: 'size-7 [&_svg]:size-4',
        lg: 'size-8 [&_svg]:size-[18px]',
      },
      active: {
        true: 'bg-primary-soft text-primary',
        false: 'text-ink-2 hover:bg-inset',
      },
    },
    defaultVariants: {
      size: 'md',
      active: false,
    },
  },
);

type IconButtonProps = Omit<React.ComponentProps<'button'>, 'title'> &
  VariantProps<typeof iconButtonVariants> & {
    title: string;
  };

export function IconButton({
  className,
  size,
  active,
  title,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={cn(iconButtonVariants({ size, active }), className)}
      {...props}
    >
      {children}
    </button>
  );
}

export { iconButtonVariants };
