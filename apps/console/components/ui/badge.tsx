import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'accent' | 'success' | 'muted';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink border-hairline',
  accent: 'bg-accent/15 text-accent-hover border-accent/30',
  success: 'bg-success/15 text-success border-success/30',
  muted: 'bg-surface-1 text-ink-subtle border-hairline',
};

type Props = HTMLAttributes<HTMLSpanElement> & { tone?: Tone };

export function Badge({ className, tone = 'neutral', ...rest }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 h-6 text-xs font-medium rounded-full border',
        toneClass[tone],
        className,
      )}
      {...rest}
    />
  );
}
