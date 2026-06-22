'use client';

import * as ToggleGroup from '@radix-ui/react-toggle-group';

import { cn } from '@/lib/utils';

type SegmentedOption = { value: string; label: string };

type SegmentedProps = {
  options: Array<string | SegmentedOption>;
  value: string;
  onChange?: (value: string) => void;
  variant?: 'neutral' | 'accent';
  className?: string;
};

export function Segmented({
  options,
  value,
  onChange,
  variant = 'neutral',
  className,
}: SegmentedProps) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange?.(next);
      }}
      className={cn('inline-flex gap-px rounded-md border border-border bg-inset p-0.5', className)}
    >
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        return (
          <ToggleGroup.Item
            key={val}
            value={val}
            className={cn(
              'cursor-pointer rounded-sm px-2.5 py-1 font-sans text-sm font-medium text-ink-2 transition-colors outline-none focus-visible:shadow-[var(--tp-focus-ring)]',
              variant === 'accent'
                ? 'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground'
                : 'data-[state=on]:bg-canvas data-[state=on]:text-ink data-[state=on]:shadow-sm',
            )}
          >
            {label}
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
