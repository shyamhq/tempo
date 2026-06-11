'use client';

import type { LucideIcon } from 'lucide-react';
import { SectionFrame } from '../settings-modal';

export function ComingSoon({
  title,
  description,
  icon: Icon,
  body,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  body: string;
}) {
  return (
    <SectionFrame title={title} description={description}>
      <div className="mt-6 grid place-items-center rounded-xl border border-dashed border-hairline bg-surface-2/40 px-8 py-16">
        <div className="max-w-md text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent-deep">
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
          <h3 className="text-heading-5 text-ink">Coming soon</h3>
          <p className="mt-2 text-caption text-ink-subtle">{body}</p>
        </div>
      </div>
    </SectionFrame>
  );
}
