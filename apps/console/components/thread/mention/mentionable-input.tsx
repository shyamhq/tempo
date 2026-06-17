'use client';

import type { Mention } from '@tempo/contracts';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { MentionCandidate } from './use-mention-candidates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MentionDoc = {
  /** Plain-text serialisation — mention tokens rendered as `@Label`. */
  text: string;
  /** Deduped list of mentioned entities in document order. */
  mentions: Mention[];
};

export type MentionableInputRef = {
  focus: () => void;
  clear: () => void;
  serialise: () => MentionDoc;
};

type PickerState = { open: false } | { open: true; query: string; anchorEl: HTMLSpanElement };

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function serialiseDom(el: HTMLElement): MentionDoc {
  const seen = new Set<string>();
  const mentions: Mention[] = [];
  const parts: string[] = [];

  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const span = node as HTMLElement;
      if (span.dataset.mentionId !== undefined) {
        const id = span.dataset.mentionId;
        const kind = span.dataset.mentionKind as Mention['kind'];
        const label = span.dataset.mentionLabel ?? span.textContent?.slice(1) ?? '';
        parts.push(`@${label}`);
        if (!seen.has(id)) {
          seen.add(id);
          mentions.push({ id, kind, label });
        }
      } else {
        // Any other inline element (e.g. browser-inserted <br>, anchor wrapper)
        parts.push(span.textContent ?? '');
      }
    }
  }

  return { text: parts.join('').trim(), mentions };
}

// ---------------------------------------------------------------------------
// Picker overlay — full-width, positioned above the input via CSS `bottom: 100%`
// ---------------------------------------------------------------------------

type OverlayProps = {
  query: string;
  candidates: MentionCandidate[];
  anchorRef: React.RefObject<HTMLElement | null>;
  onSelect: (candidate: MentionCandidate) => void;
  onDismiss: () => void;
};

function MentionOverlay({ query, candidates, anchorRef, onSelect, onDismiss }: OverlayProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const q = query.toLowerCase();

  // Agent always appears; users filtered by query.
  const filtered = candidates.filter(
    (c) => c.kind === 'agent' || c.label.toLowerCase().includes(q),
  );

  // Reset active row when the query changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query is a prop — resetting on change is intentional
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Arrow/Enter/Escape are captured at document level so they intercept
  // before the composer's own keydown handler.
  useEffect(() => {
    const count = Math.max(filtered.length, 1);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % count);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + count) % count);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const hit = filtered[activeIdx];
        if (hit) onSelect(hit);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [filtered, activeIdx, onSelect, onDismiss]);

  // Portal-anchored to the input's bounding rect so the picker escapes any
  // `overflow:hidden` ancestor (BlockNote's FloatingThread popover, the comment
  // card's rounded clip). Recomputed on open + on scroll/resize.
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const compute = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ left: r.left, top: r.top, width: r.width });
    };
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [anchorRef]);

  if (filtered.length === 0 || !pos || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="listbox"
      aria-label="Mention picker"
      style={{
        position: 'fixed',
        left: pos.left,
        // Anchor BOTTOM of the picker to the TOP of the input (i.e. picker
        // grows upward). `translateY(-100%)` keeps it tight against the input
        // regardless of picker height.
        top: pos.top,
        width: pos.width,
        transform: 'translateY(-100%) translateY(-4px)',
        zIndex: 1000,
      }}
      className="rounded-lg border border-hairline-strong bg-surface-1 shadow-card-elevated overflow-hidden"
    >
      {filtered.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="option"
          aria-selected={i === activeIdx}
          onMouseEnter={() => setActiveIdx(i)}
          onClick={() => onSelect(c)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
            i === activeIdx ? 'bg-surface-2' : ''
          }`}
        >
          <span
            className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-micro font-semibold ${
              c.kind === 'agent' ? 'bg-accent/15 text-accent-deep' : 'bg-surface-3 text-ink-subtle'
            }`}
          >
            {c.kind === 'agent' ? '✦' : c.label.charAt(0).toUpperCase()}
          </span>
          <span className="text-body-sm text-ink">{c.label}</span>
          {c.kind === 'agent' ? (
            <span className="ml-auto text-micro text-ink-tertiary">Agent</span>
          ) : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// MentionableInput
// ---------------------------------------------------------------------------

type Props = {
  placeholder?: string;
  autoFocus?: boolean;
  candidates: MentionCandidate[];
  /** Min content height in px (default 66 — ~3 lines at 1.55 leading). */
  minHeight?: number;
  /** Max content height in px before scrolling (default 280 — ~12 lines). */
  maxHeight?: number;
  className?: string;
  /** Called on Cmd+Enter when picker is closed and there is content. */
  onSubmit: (doc: MentionDoc) => void;
  /** Called on every input event so parents can derive hasContent. */
  onChange?: (doc: MentionDoc) => void;
};

export const MentionableInput = forwardRef<MentionableInputRef, Props>(function MentionableInput(
  {
    placeholder,
    autoFocus,
    candidates,
    minHeight = 66,
    maxHeight = 280,
    className,
    onSubmit,
    onChange,
  },
  ref,
) {
  const divRef = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState<PickerState>({ open: false });

  useImperativeHandle(
    ref,
    () => ({
      focus: () => divRef.current?.focus(),
      clear: () => {
        if (divRef.current) divRef.current.innerHTML = '';
      },
      serialise: () => (divRef.current ? serialiseDom(divRef.current) : { text: '', mentions: [] }),
    }),
    [],
  );

  useEffect(() => {
    if (autoFocus) divRef.current?.focus();
  }, [autoFocus]);

  const dismissPicker = useCallback(() => setPicker({ open: false }), []);

  const emitChange = useCallback(() => {
    if (onChange && divRef.current) onChange(serialiseDom(divRef.current));
  }, [onChange]);

  // Insert a mention token at cursor, removing the preceding `@query` anchor span.
  const insertMention = useCallback(
    (candidate: MentionCandidate) => {
      if (!picker.open) return;
      const anchorEl = picker.anchorEl;
      dismissPicker();

      const sel = window.getSelection();
      if (!sel) return;

      // Remove the temporary anchor span (contains the `@query` text).
      const parent = anchorEl.parentNode;
      if (!parent) return;
      const insertBefore = anchorEl.nextSibling;
      parent.removeChild(anchorEl);

      // Build the non-editable mention span.
      const span = document.createElement('span');
      span.className = 'mention-token';
      span.contentEditable = 'false';
      span.dataset.mentionId = candidate.id;
      span.dataset.mentionKind = candidate.kind;
      span.dataset.mentionLabel = candidate.label;
      span.textContent = `@${candidate.label}`;

      const space = document.createTextNode(' ');

      parent.insertBefore(space, insertBefore);
      parent.insertBefore(span, space);

      // Place cursor after the trailing space.
      const range = document.createRange();
      range.setStartAfter(space);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      divRef.current?.focus();
      emitChange();
    },
    [picker, dismissPicker, emitChange],
  );

  const handleInput = useCallback(() => {
    const el = divRef.current;
    if (!el) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      dismissPicker();
      emitChange();
      return;
    }

    const range = sel.getRangeAt(0);
    const node = range.startContainer;

    // Only scan text nodes for `@`.
    if (node.nodeType !== Node.TEXT_NODE) {
      dismissPicker();
      emitChange();
      return;
    }

    const text = node.textContent ?? '';
    const offset = range.startOffset;
    const before = text.slice(0, offset);
    const atPos = before.lastIndexOf('@');

    if (atPos === -1 || /\s/.test(before.slice(atPos + 1))) {
      dismissPicker();
      emitChange();
      return;
    }

    const fragment = before.slice(atPos + 1);

    if (!picker.open) {
      // Wrap the `@query` fragment in a temporary anchor span.
      const anchorRange = document.createRange();
      anchorRange.setStart(node, atPos);
      anchorRange.setEnd(node, offset);
      const anchorSpan = document.createElement('span');
      anchorSpan.dataset.mentionAnchor = '1';
      anchorRange.surroundContents(anchorSpan);

      // Restore cursor to the end of the text inside the anchor span.
      const textNode = anchorSpan.firstChild;
      if (textNode) {
        const cur = document.createRange();
        cur.setStart(textNode, textNode.textContent?.length ?? 0);
        cur.collapse(true);
        sel.removeAllRanges();
        sel.addRange(cur);
      }

      setPicker({ open: true, query: fragment, anchorEl: anchorSpan });
    } else {
      // Update the query as the user keeps typing.
      setPicker((p) => (p.open ? { ...p, query: fragment } : p));
    }

    emitChange();
  }, [picker, dismissPicker, emitChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Cmd+Enter submits — but only when the picker is not consuming Enter.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !picker.open) {
        e.preventDefault();
        if (!divRef.current) return;
        const doc = serialiseDom(divRef.current);
        if (doc.text.length === 0) return;
        onSubmit(doc);
        divRef.current.innerHTML = '';
        emitChange();
      }
    },
    [picker.open, onSubmit, emitChange],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      // Keep picker open if focus moved into the overlay.
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest('[role="listbox"]')) return;
      dismissPicker();
    },
    [dismissPicker],
  );

  return (
    <div className="relative">
      {picker.open ? (
        <MentionOverlay
          query={picker.query}
          candidates={candidates}
          anchorRef={divRef}
          onSelect={insertMention}
          onDismiss={dismissPicker}
        />
      ) : null}
      {/* biome-ignore lint/a11y/useSemanticElements: contentEditable rich-text cannot be replaced by <textarea> */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: contentEditable is natively focusable without tabIndex */}
      <div
        ref={divRef}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        contentEditable
        suppressContentEditableWarning
        data-mention-input
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={`block w-full bg-transparent text-body-sm leading-[1.55] text-ink focus:outline-none overflow-y-auto ${className ?? ''}`}
        style={{ minHeight, maxHeight }}
      />
    </div>
  );
});
