'use client';

// Client-only renderer for the htmlBlock. Renders agent-authored HTML inside
// a sandboxed iframe — `sandbox="allow-scripts"` (no allow-same-origin) gives
// the frame an opaque origin: scripts run inside but cannot reach Console
// cookies, localStorage, or parent DOM. CDN fetches (Tailwind, Google Fonts)
// still work. HTML is rendered verbatim — sandbox is the trust boundary.
//
// Four concerns live here: (1) height-shim message protocol with the iframe,
// (2) bottom-edge resize handle that persists `height` on pointerup, (3)
// `</>` source toggle — source mode mounts a CodeMirror editor (lazy-loaded
// via `next/dynamic` so the editor chunk only ships when a Dev opens
// source), and both views stay mounted with `display` toggled so toggling
// doesn't tear down editor state or reload the iframe, (4) CSS-expand to
// fill the nearest `[data-plan-column]` ancestor.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

const MIN_HEIGHT = 120;
const CAP = 600;
const EXPAND_GUTTER = 16;

// Lazy-load the CodeMirror editor. It pulls in @codemirror/* (~150 KB
// gzipped) — heavy enough that we don't want every plan reader to pay for
// it. SSR off because CM 6 reads `window` at module load.
const HtmlSourceEditor = dynamic(() => import('./html-source-editor'), {
  ssr: false,
  loading: () => (
    <div
      className="bn-html-source"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--tp-ink-3)',
        fontSize: 12,
      }}
    >
      Loading editor…
    </div>
  ),
});

// Injected into srcdoc ahead of the user HTML. The shim's `<script>` is a
// fully-closed element before `${html}` is interpolated, so agent-authored
// HTML cannot inject into the shim's parse context. The shim posts content
// height up on every document mutation, echoing a per-instance id so the
// parent can filter messages by identity. `event.source` is the standard
// filter; we belt-and-brace with the id in case browser quirks prevent the
// source comparison from holding under `sandbox="allow-scripts"`.
// Worst case if the agent's own HTML includes a hostile `<script>` that
// fakes height messages: it can only nudge `autoHeight` within `[MIN, CAP]`.
// Source / resize commits never flow through postMessage.
//
// `postMessage` `targetOrigin` is `'*'` by necessity: the frame has an opaque
// origin under sandbox-without-allow-same-origin, so it cannot name the Console
// origin specifically. The receiver compensates with the `event.source` +
// `instanceId` filters above — the documented pattern for opaque-origin frames
// (https://html.spec.whatwg.org/multipage/web-messaging.html#posting-messages).
// The payload is a pixel height with no user content; nothing sensitive leaks
// even if a hypothetical outer frame eavesdrops.
function buildSrcdoc(html: string, instanceId: string): string {
  return `<script>(function(){
    var id = ${JSON.stringify(instanceId)};
    var post = function(){
      parent.postMessage({type:'tempo:htmlBlock:height',id:id,h:document.documentElement.scrollHeight},'*');
    };
    new ResizeObserver(post).observe(document.documentElement);
    window.addEventListener('load', post);
  })();</script>${html}`;
}

const TOOLBAR_BTN: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  cursor: 'pointer',
  background: 'color-mix(in srgb, var(--tp-canvas) 95%, transparent)',
  border: '1px solid var(--tp-border)',
  borderRadius: 4,
  color: 'var(--tp-ink-2)',
};

type Props = {
  html: string;
  height: number;
  onSourceCommit: (html: string) => void;
  onResizeCommit: (height: number) => void;
};

export function HtmlRenderer({ html, height, onSourceCommit, onResizeCommit }: Props) {
  const instanceId = useId();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [autoHeight, setAutoHeight] = useState(MIN_HEIGHT);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  // Empty blocks open in source mode so the slash-menu insertion lands the
  // Dev directly in the editable surface instead of staring at an inert frame.
  // Filled blocks open in preview as before.
  const [sourceMode, setSourceMode] = useState(() => html === '');
  const [expanded, setExpanded] = useState(false);
  // Horizontal bounds of the plan column (the nearest `[data-plan-column]`
  // ancestor). Computed when expanding so the expanded view fills the column
  // horizontally and the viewport vertically — leaving nav + discussion panel
  // visible and interactive on either side.
  const [columnBox, setColumnBox] = useState<{ left: number; right: number } | null>(null);

  const effectiveHeight: number = dragHeight ?? (height > 0 ? height : autoHeight);

  // Height reports from the iframe shim. Two filters:
  //   1. event.source === our iframe contentWindow (identity check) — must
  //      compare to a non-null contentWindow, otherwise a detached message
  //      with `event.source === null` and `iframeRef.current === null`
  //      passes (`null === null`).
  //   2. event.data.id === our instanceId (defence against browser quirks)
  // Only adjust autoHeight when no explicit height is set (height === 0).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const ownWindow = iframeRef.current?.contentWindow;
      if (!ownWindow || e.source !== ownWindow) return;
      const data = e.data as { type?: string; id?: string; h?: number } | null;
      if (data?.type !== 'tempo:htmlBlock:height') return;
      if (data.id !== instanceId) return;
      const h = Number(data.h);
      if (!Number.isFinite(h)) return;
      setAutoHeight(Math.min(Math.max(MIN_HEIGHT, h), CAP));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [instanceId]);

  // Reset auto-grown height when the committed html changes — the iframe is
  // about to navigate to a fresh srcdoc whose content height we don't know
  // yet. Without this, the old document's reported height lingers as empty
  // space below shorter new content until the shim fires. The dep IS `html`;
  // biome misreads setter-only effects as having no semantic dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: html is the trigger
  useEffect(() => {
    setAutoHeight(MIN_HEIGHT);
  }, [html]);

  // ESC closes expanded view.
  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setExpanded(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Track the plan column's horizontal bounds while expanded, so the fixed-
  // position overlay stays aligned if the viewport is resized.
  useEffect(() => {
    if (!expanded) {
      setColumnBox(null);
      return;
    }
    const columnEl = wrapRef.current?.closest('[data-plan-column]');
    if (!(columnEl instanceof HTMLElement)) return;
    const column: HTMLElement = columnEl;
    function measure() {
      const box = column.getBoundingClientRect();
      setColumnBox({ left: box.left, right: window.innerWidth - box.right });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [expanded]);

  // Read effectiveHeight via ref so the callback identity doesn't churn on
  // every pointermove during a drag (each move rebuilds effectiveHeight via
  // setDragHeight → autoHeight/dragHeight change → new effectiveHeight). The
  // active drag uses the closure's `startH`; the ref is only read at the next
  // pointerdown.
  const effectiveHeightRef = useRef(effectiveHeight);
  effectiveHeightRef.current = effectiveHeight;

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      const startY = e.clientY;
      const startH = effectiveHeightRef.current;
      target.setPointerCapture(e.pointerId);

      function teardown() {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onCancel);
        if (target.hasPointerCapture(e.pointerId)) {
          target.releasePointerCapture(e.pointerId);
        }
      }
      function onMove(ev: PointerEvent) {
        const next = Math.max(MIN_HEIGHT, startH + (ev.clientY - startY));
        setDragHeight(next);
      }
      function onUp(ev: PointerEvent) {
        teardown();
        const final = Math.max(MIN_HEIGHT, startH + (ev.clientY - startY));
        setDragHeight(null);
        // Persist once, on release — never per-mousemove.
        onResizeCommit(final);
      }
      // `pointercancel` (touch stolen by scroll, window blur, etc.) has
      // undefined coordinates — do NOT commit a height from it; just restore.
      function onCancel() {
        teardown();
        setDragHeight(null);
      }
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onCancel);
    },
    [onResizeCommit],
  );

  const dragging = dragHeight !== null;
  const srcdoc = buildSrcdoc(html, instanceId);

  // Color / surface / border values come from the console `--tp-*` design
  // tokens (app/tokens/*.css).
  const wrapStyle: React.CSSProperties = expanded
    ? {
        position: 'fixed',
        top: EXPAND_GUTTER,
        bottom: EXPAND_GUTTER,
        left: (columnBox?.left ?? 0) + EXPAND_GUTTER,
        right: (columnBox?.right ?? 0) + EXPAND_GUTTER,
        zIndex: 50,
        background: 'var(--tp-canvas)',
        border: '1px solid var(--tp-border)',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)',
      }
    : {
        position: 'relative',
        width: '100%',
        border: '1px solid var(--tp-border)',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--tp-canvas)',
      };

  const bodyStyle: React.CSSProperties = expanded
    ? { flex: 1, minHeight: 0, position: 'relative' }
    : { height: effectiveHeight, position: 'relative' };

  return (
    <div ref={wrapRef} style={wrapStyle}>
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          zIndex: 3,
          display: 'flex',
          gap: 4,
        }}
      >
        <button
          type="button"
          onClick={() => setSourceMode((v) => !v)}
          title={sourceMode ? 'Show preview' : 'Show source'}
          style={TOOLBAR_BTN}
        >
          {sourceMode ? 'Preview' : '</>'}
        </button>
        <button
          type="button"
          onClick={() => {
            // Pre-measure the plan column synchronously so the first paint of
            // the fixed-position overlay lands at the correct horizontal bounds.
            // Without this, columnBox is null on the expand-render and the
            // overlay snaps from viewport edges to the column for one frame.
            if (!expanded) {
              const col = wrapRef.current?.closest('[data-plan-column]');
              if (col instanceof HTMLElement) {
                const box = col.getBoundingClientRect();
                setColumnBox({ left: box.left, right: window.innerWidth - box.right });
              }
            }
            setExpanded((v) => !v);
          }}
          title={expanded ? 'Collapse' : 'Expand'}
          style={TOOLBAR_BTN}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      <div style={bodyStyle}>
        {/* Both views are always mounted so toggling Preview/source doesn't
            tear down the editor's local state nor reload the iframe's
            srcdoc. Visibility flips via `display`. */}
        <div
          style={{
            display: sourceMode ? 'block' : 'none',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
          }}
        >
          <HtmlSourceEditor value={html} onCommit={onSourceCommit} />
        </div>
        <iframe
          ref={iframeRef}
          title="htmlBlock"
          srcDoc={srcdoc}
          sandbox="allow-scripts"
          style={{
            display: sourceMode ? 'none' : 'block',
            width: '100%',
            height: '100%',
            border: 0,
            // Block iframe from swallowing pointer events while the user is
            // dragging the bottom handle — otherwise the cursor entering the
            // iframe area would lose the drag.
            pointerEvents: dragging ? 'none' : 'auto',
            background: 'var(--tp-canvas)',
          }}
        />
        {/* Empty-preview hint. The iframe sits underneath at the same size;
            this overlay tells the Dev what to do when there's nothing to
            render. Click target falls through to the iframe (no pointer
            events), which is fine — the Dev clicks `</>` in the toolbar. */}
        {!sourceMode && html === '' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              color: 'var(--tp-ink-3)',
              fontSize: 13,
              fontFamily: 'sans-serif',
              pointerEvents: 'none',
              background: 'var(--tp-canvas)',
            }}
          >
            Blank HTML block — click
            <code
              style={{
                padding: '1px 6px',
                background: 'var(--tp-inset)',
                color: 'var(--tp-ink-2)',
                borderRadius: 3,
                fontSize: 12,
              }}
            >
              {'</>'}
            </code>
            to add HTML
          </div>
        )}
      </div>

      {!sourceMode && !expanded && (
        <div
          onPointerDown={startResize}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 6,
            cursor: 'ns-resize',
            background: 'transparent',
            zIndex: 2,
          }}
        />
      )}
    </div>
  );
}
