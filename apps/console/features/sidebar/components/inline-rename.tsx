'use client';

// Inline rename field for a space / thread row. Commits on Enter or blur,
// cancels on Escape; an unchanged or empty value cancels. Presentational — the
// parent row wires onCommit to the sidebar slice's rename action.

import { type KeyboardEvent, useEffect, useRef } from 'react';

export function InlineRename({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    const v = ref.current?.value.trim();
    if (!v || v === initial) {
      onCancel();
      return;
    }
    onCommit(v);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      onKeyDown={onKey}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="w-full min-w-0 rounded-xs border border-primary bg-canvas px-1.5 py-0.5 text-sm text-ink outline-none shadow-[var(--tp-focus-ring)]"
    />
  );
}
