import type * as React from 'react';

import { cn } from '@/lib/utils';

const DOT_TONE = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-primary',
  actor: 'bg-actor',
  neutral: 'bg-ink-3',
} as const;

type PillProps = React.ComponentProps<'span'> & {
  tone?: keyof typeof DOT_TONE;
  dot?: boolean;
  pulse?: boolean;
};

export function Pill({
  className,
  tone = 'neutral',
  dot = true,
  pulse = false,
  children,
  ...props
}: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[27px] items-center gap-1.5 rounded-md border border-border bg-canvas px-2.5 text-sm font-medium text-ink-2 whitespace-nowrap',
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          className={cn('size-[7px] shrink-0 rounded-full', DOT_TONE[tone], pulse && 'tp-pulse')}
        />
      ) : null}
      {children}
    </span>
  );
}
