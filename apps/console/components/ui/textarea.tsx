import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'block w-full rounded-md border border-hairline bg-surface-2 text-ink placeholder:text-ink-tertiary px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-accent-focus focus-visible:ring-1 focus-visible:ring-accent-focus resize-y min-h-[80px]',
        className,
      )}
      {...rest}
    />
  );
});
