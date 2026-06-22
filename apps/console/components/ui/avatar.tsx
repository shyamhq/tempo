import type * as React from 'react';

import { cn } from '@/lib/utils';

const AGENT_GRADIENT = 'linear-gradient(150deg, var(--tp-success), #3FA66E)';

type AvatarProps = Omit<React.ComponentProps<'span'>, 'color'> & {
  name?: string;
  kind?: 'user' | 'agent';
  size?: number;
  color?: string;
};

export function Avatar({
  className,
  name = '',
  kind = 'user',
  size = 20,
  color,
  style,
  ...props
}: AvatarProps) {
  const isAgent = kind === 'agent';
  const initial = isAgent ? '✦' : (name.trim()[0] || '?').toUpperCase();
  const background = color ?? (isAgent ? AGENT_GRADIENT : 'var(--tp-actor)');

  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-sans font-semibold text-white',
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.28)),
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        background,
        ...style,
      }}
      {...props}
    >
      {initial}
    </span>
  );
}
