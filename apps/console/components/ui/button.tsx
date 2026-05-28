import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface-2 text-ink hover:bg-surface-3 border border-hairline',
  ghost:
    'bg-transparent text-ink-muted hover:text-ink hover:bg-surface-2 border border-transparent',
  danger:
    'bg-transparent text-ink-muted hover:text-ink border border-hairline hover:border-hairline-strong',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs rounded-md',
  md: 'h-8 px-3 text-sm rounded-md',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'secondary', size = 'md', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-focus',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    />
  );
});
