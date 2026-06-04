'use client';

import { Button } from '@/components/ui/button';

export function PlanSaveBar({
  isDirty,
  save,
  discard,
}: {
  isDirty: boolean;
  save: () => void;
  discard: () => void;
}) {
  if (!isDirty) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-hairline bg-surface-1 py-2 pr-2 pl-4 shadow-xl animate-in fade-in slide-in-from-bottom-3 duration-200">
      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
      <span className="pr-2 text-sm font-medium text-ink">Unsaved changes</span>
      <Button variant="ghost" size="sm" onClick={discard}>
        Discard
      </Button>
      <Button variant="primary" size="sm" onClick={save}>
        Save
        <kbd className="ml-1.5 font-mono text-micro opacity-70">⌘S</kbd>
      </Button>
    </div>
  );
}
