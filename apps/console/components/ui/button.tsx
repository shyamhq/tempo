import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const variantClass: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover border border-transparent',
  accent: 'bg-accent text-on-accent hover:bg-accent-hover border border-transparent',
  secondary: 'bg-transparent text-ink hover:bg-surface-2 border border-hairline',
  ghost:
    'bg-transparent text-ink-muted hover:text-ink hover:bg-surface-2 border border-transparent',
  danger:
    'bg-transparent text-ink-muted hover:text-danger border border-hairline hover:border-danger/40',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-4 text-xs rounded-full',
  md: 'h-9 px-5 text-sm rounded-full',
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
        'inline-flex items-center justify-center gap-1.5 font-medium transition disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-soft',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    />
  );
});
