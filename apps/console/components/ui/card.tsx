import type * as React from 'react';

import { cn } from '@/lib/utils';

type CardProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  interactive?: boolean;
  padding?: number;
};

export function Card({
  className,
  title,
  meta,
  interactive = false,
  padding = 14,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-canvas transition-colors',
        interactive && 'cursor-pointer hover:border-border-strong',
        className,
      )}
      {...props}
    >
      {title || meta ? (
        <div
          className="flex items-center gap-2 border-b border-border"
          style={{ padding: `10px ${padding}px` }}
        >
          {title ? (
            <span className="font-display text-base font-semibold tracking-snug text-ink">
              {title}
            </span>
          ) : null}
          {meta ? <span className="ml-auto font-mono text-xs text-ink-3">{meta}</span> : null}
        </div>
      ) : null}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}
