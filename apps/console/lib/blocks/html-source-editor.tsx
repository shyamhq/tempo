'use client';

// CodeMirror 6 source editor for the htmlBlock. Lives behind a `next/dynamic`
// boundary (see `html-renderer.tsx`) so the editor bundle only loads when a
// Dev opens source mode — preview-only readers don't pay the cost.
//
// Why CodeMirror over a plain textarea: line numbers, HTML syntax
// highlighting, active-line gutter, bracket matching, native multi-cursor /
// fold / find — all from `basicSetup`'s defaults. Same primitive scales to a
// side-by-side plan diff viewer later via `@codemirror/merge` (planned —
// not in this change).
//
// Commit cadence: we hold a local `draft` and call `onCommit` on blur (when
// focus leaves the editor entirely), on Cmd/Ctrl+S, and on Preview-toggle
// (the parent invokes the committed callback before flipping). Per-keystroke
// commits would round-trip through the PM doc and re-render BN on every key.
//
// Re-sync: when `value` changes from outside (Agent edit, outer undo) and
// the editor isn't currently focused, we update `draft` to follow. While
// focused we hold the draft so the user's keystrokes aren't overwritten by
// the external write that our own previous commit triggered.

import { html } from '@codemirror/lang-html';
import CodeMirror, { type Extension } from '@uiw/react-codemirror';
import { useEffect, useRef, useState } from 'react';

const EXTENSIONS: Extension[] = [html()];

type Props = {
  value: string;
  onCommit: (next: string) => void;
};

export default function HtmlSourceEditor({ value, onCommit }: Props) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  // Follow external writes while not focused. Skipping during focus avoids
  // clobbering an active edit with the round-trip from our own previous
  // commit (which would land back as a `value` change).
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    // `onBlurCapture` fires when focus leaves any descendant. Intra-editor
    // focus shifts (e.g., search panel open → editor) carry a `relatedTarget`
    // inside this wrapper — those don't count as leaving.
    <div
      className="bn-html-source"
      onFocusCapture={() => {
        focusedRef.current = true;
      }}
      onBlurCapture={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && e.currentTarget.contains(next)) return;
        focusedRef.current = false;
        commit();
      }}
      // Bubble phase (not capture) so CodeMirror's own keymap fires first —
      // a capture-phase stopPropagation would prevent CM from ever seeing the
      // event. CM consumes Cmd+A / Cmd+Z / Cmd+Y inside its own EditorView;
      // we then stop the bubble so BlockNote's root keydown listener (on an
      // ancestor element) doesn't also fire on the same event and act on the
      // outer document.
      onKeyDown={(e) => {
        // Cmd/Ctrl+S commits without leaving the editor — natural muscle
        // memory for code editors. Not in CM's default keymap, so we own it.
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          commit();
        }
        if (e.metaKey || e.ctrlKey) e.stopPropagation();
      }}
    >
      <CodeMirror
        value={draft}
        extensions={EXTENSIONS}
        placeholder="Type or paste HTML here…"
        indentWithTab
        onChange={(next) => setDraft(next)}
      />
    </div>
  );
}
