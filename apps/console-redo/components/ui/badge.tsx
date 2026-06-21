import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill px-[7px] py-px font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        accent: 'bg-primary-soft text-primary',
        success: 'bg-success-bg text-success',
        warning: 'bg-warning-bg text-warning',
        danger: 'bg-danger-bg text-danger',
        actor: 'bg-actor-bg text-actor',
        neutral: 'bg-inset text-ink-2',
        muted: 'bg-inset text-ink-3',
      },
      mono: {
        true: 'font-mono',
        false: 'font-sans',
      },
      uppercase: {
        true: 'text-2xs tracking-label uppercase',
        false: 'text-xs tracking-mono',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      mono: false,
      uppercase: false,
    },
  },
);

type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, mono, uppercase, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, mono, uppercase }), className)} {...props} />;
}

export { badgeVariants };
