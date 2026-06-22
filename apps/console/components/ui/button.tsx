import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm font-medium tracking-snug whitespace-nowrap font-sans transition-colors outline-none focus-visible:shadow-[var(--tp-focus-ring)] disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-press',
        secondary: 'border border-border-strong bg-canvas text-ink hover:bg-accent',
        ghost: 'border border-transparent bg-transparent text-primary hover:bg-primary-soft',
        danger:
          'border border-border-strong bg-transparent text-danger hover:bg-danger hover:text-primary-foreground',
      },
      size: {
        sm: 'h-[26px] px-[9px] text-sm',
        md: 'h-[29px] px-[11px] text-base',
        lg: 'h-9 px-4 text-lg',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    icon?: React.ReactNode;
    kbd?: string;
  };

export function Button({
  className,
  variant,
  size,
  fullWidth,
  asChild = false,
  icon,
  kbd,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  // Radix Slot requires exactly one child, so with `asChild` the consumer's
  // single element IS the content (it composes its own icon inside). The
  // icon/kbd affordances only apply to the plain <button> form — rendering their
  // null placeholders alongside `children` would hand Slot 3 children and throw.
  return (
    <Comp className={cn(buttonVariants({ variant, size, fullWidth }), className)} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {icon ? <span className="inline-flex size-[13px]">{icon}</span> : null}
          {children}
          {kbd ? (
            <span className="ml-0.5 rounded-[3px] border border-current px-1 font-mono text-[10px] opacity-70">
              {kbd}
            </span>
          ) : null}
        </>
      )}
    </Comp>
  );
}

export { buttonVariants };
