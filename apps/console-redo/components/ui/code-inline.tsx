import type * as React from 'react';

import { cn } from '@/lib/utils';

type CodeInlineProps = React.ComponentProps<'code'> & {
  accent?: boolean;
};

export function CodeInline({ className, accent = false, ...props }: CodeInlineProps) {
  if (accent) {
    return (
      <span
        className={cn(
          'rounded-xs bg-primary-soft px-[5px] py-px font-mono text-[0.84em] font-medium whitespace-nowrap text-primary',
          className,
        )}
        {...props}
      />
    );
  }
  return (
    <code
      className={cn(
        'rounded-xs border border-border bg-code-bg px-[5px] py-[1.5px] font-mono text-[0.86em] whitespace-nowrap text-code-ink',
        className,
      )}
      {...props}
    />
  );
}
