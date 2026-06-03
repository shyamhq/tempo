'use client';

import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useState } from 'react';

export function usePlanSave(
  editor: Editor | null,
  persist: (markdown: string) => Promise<void> | void,
) {
  const [isDirty, setIsDirty] = useState(false);
  const [discardKey, setDiscardKey] = useState(0);

  const notifyEdit = useCallback(() => setIsDirty(true), []);

  const save = useCallback(async () => {
    if (!editor || !isDirty) return;
    const md = (
      editor.storage as unknown as { markdown: { getMarkdown(): string } }
    ).markdown.getMarkdown();
    try {
      await persist(md);
      setIsDirty(false);
    } catch {
      // Leave isDirty=true so the bar stays visible and the Dev can retry.
    }
  }, [editor, isDirty, persist]);

  const discard = useCallback(() => {
    if (!isDirty) return;
    if (typeof window !== 'undefined' && !window.confirm('Discard unsaved changes?')) return;
    setIsDirty(false);
    setDiscardKey((k) => k + 1);
  }, [isDirty]);

  useEffect(() => {
    if (!editor?.isEditable) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== 's' && e.key !== 'S') return;
      e.preventDefault();
      if (isDirty) void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, isDirty, save]);

  return { isDirty, save, discard, discardKey, notifyEdit };
}
