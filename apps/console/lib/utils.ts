import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// twMerge groups `text-*` utilities by prefix. Without this extension it would
// drop our named typography tokens (`text-caption`, `text-body-sm`, …) when a
// className mixes them with a colour like `text-ink-muted` via cn().
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'hero-display',
            'display-lg',
            'heading-1',
            'heading-2',
            'heading-3',
            'heading-4',
            'heading-5',
            'subtitle',
            'body-md',
            'body-md-medium',
            'body-sm',
            'body-sm-medium',
            'caption',
            'caption-bold',
            'micro',
            'micro-uppercase',
            'button-md',
            'code-md',
            'code-sm',
            'code-inline',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
