import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const bannerVariants = cva('flex items-center gap-2.5 rounded-lg px-[13px] py-[9px] text-base', {
  variants: {
    tone: {
      accent: 'bg-primary-soft text-primary',
      warning: 'bg-warning-bg text-warning',
      danger: 'bg-danger-bg text-danger',
      success: 'bg-success-bg text-success',
    },
  },
  defaultVariants: {
    tone: 'accent',
  },
});

type BannerAction = { label: string; onClick?: () => void };

type BannerProps = React.ComponentProps<'div'> &
  VariantProps<typeof bannerVariants> & {
    icon?: React.ReactNode;
    action?: BannerAction;
  };

export function Banner({ className, tone, icon, action, children, ...props }: BannerProps) {
  return (
    <div className={cn(bannerVariants({ tone }), className)} {...props}>
      {icon ? <span className="inline-flex size-[15px] shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1">{children}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="cursor-pointer font-sans text-base font-semibold whitespace-nowrap text-current outline-none focus-visible:shadow-[var(--tp-focus-ring)]"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export { bannerVariants };
