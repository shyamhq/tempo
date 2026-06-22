'use client';

// Capture the editor's current text selection as a comment anchor: the quoted
// text, ±CONTEXT_RADIUS chars of surrounding context, and the start block's id.
// Read at the moment createThread fires (before the comment mark is stamped) so
// the Comment row carries enough for the Agent to re-anchor against if the plan
// is later edited. Mirrors apps/console's proven readAnchor.

import type { useCreateBlockNote } from '@blocknote/react';

// ±80 chars around the selection — large enough for fuzzy re-anchoring on a
// future edit, small enough to keep Comment rows compact.
const CONTEXT_RADIUS = 80;

export type CommentAnchor = { quote: string; context: string; blockId: string | null };

export function readAnchor(editor: ReturnType<typeof useCreateBlockNote> | null): CommentAnchor {
  if (!editor) return { quote: '', context: '', blockId: null };
  const state = editor._tiptapEditor.state;
  const { from, to } = state.selection;
  if (from === to) return { quote: '', context: '', blockId: null };
  const quote = state.doc.textBetween(from, to, ' ');
  const ctxFrom = Math.max(0, from - CONTEXT_RADIUS);
  const ctxTo = Math.min(state.doc.content.size, to + CONTEXT_RADIUS);
  const context = state.doc.textBetween(ctxFrom, ctxTo, ' ');
  // For a multi-block selection the *start* block wins — matches "where I
  // started highlighting" and how readers scan top-down.
  const $from = state.selection.$from;
  let blockId: string | null = null;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'blockContainer') {
      const id = n.attrs.id;
      if (typeof id === 'string' && id.length > 0) blockId = id;
      break;
    }
  }
  return { quote, context, blockId };
}
