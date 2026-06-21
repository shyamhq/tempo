// Shared section chrome: a display-font title + optional description, with the
// section's body below. Each settings section composes its own content inside.
// Lives apart from the modal shell so sections depend on a layout primitive, not
// the dialog that mounts them.

import type { ReactNode } from 'react';

export function SectionFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="px-8 pb-12 pt-7">
      <header className="mb-6">
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-3">{description}</p> : null}
      </header>
      {children}
    </div>
  );
}
