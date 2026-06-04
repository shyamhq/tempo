'use client';

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
    if (!v) {
      onCancel();
      return;
    }
    if (v === initial) onCancel();
    else onCommit(v);
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
      className="flex-1 min-w-0 rounded-md border border-accent bg-canvas px-1.5 py-0.5 text-body-sm text-ink outline-none shadow-[0_0_0_3px_rgba(0,212,164,0.12)]"
    />
  );
}
