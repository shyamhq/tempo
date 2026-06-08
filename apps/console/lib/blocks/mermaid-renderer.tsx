'use client';

// Client-only renderer for the mermaidDiagram block. Lives in its own file so
// `mermaid-block.tsx` (which builds the block spec) can be imported by the
// server `ServerBlockNoteEditor` path without dragging React hooks across the
// RSC boundary.
//
// We render mermaid's SVG output verbatim and trust mermaid's
// `securityLevel: 'strict'` — its purpose-built sanitizer. The first version
// double-sanitized via DOMPurify's SVG profile, which strips `<foreignObject>`
// (mermaid's flowchart-v2 wraps every label in one) and silently produced
// SVGs with no text inside any box. Mermaid sources come from authored Plan
// content (Dev or Agent), not arbitrary public input, so the threat model
// matches what mermaid's strict mode already defends against.

import { useEffect, useState } from 'react';

type Mermaid = typeof import('mermaid')['default'];
let mermaidPromise: Promise<Mermaid> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
      return m.default;
    });
  }
  return mermaidPromise;
}

// djb2 hash — cheap stable ID for the mermaid render call.
function hashSource(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

type RenderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; svg: string }
  | { kind: 'error'; source: string; message: string };

export function MermaidRenderer({ source }: { source: string }) {
  const [state, setState] = useState<RenderState>({ kind: 'idle' });

  useEffect(() => {
    if (!source) {
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'loading' });
    let cancelled = false;
    const hash = hashSource(source);

    const renderId = `tempo-mmd-${hash}`;

    loadMermaid()
      .then((mermaid) =>
        mermaid.render(renderId, source).then(({ svg }) => {
          if (cancelled) return;
          if (!svg) {
            setState({ kind: 'error', source, message: 'Empty render output' });
            return;
          }
          setState({ kind: 'ok', svg });
        }),
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        // First line only — mermaid errors include a multi-line stack of
        // tokens that bloats the banner. The Dev can debug from the
        // diagnostic; the full source is shown below it.
        const raw = err instanceof Error ? err.message : String(err);
        const message = raw.split('\n')[0]?.trim() || 'Syntax error';
        setState({ kind: 'error', source, message });
      })
      .finally(() => {
        // Mermaid creates a temporary measurement container `d{renderId}`
        // appended to <body>; it cleans up after success, but a syntax error
        // leaves the node orphaned and visible. Sweep it ourselves.
        document.getElementById(`d${renderId}`)?.remove();
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (state.kind === 'idle') return null;

  if (state.kind === 'loading') {
    return <div style={{ padding: '0.5rem', color: '#888', fontSize: '0.875rem' }}>Rendering…</div>;
  }

  if (state.kind === 'error') {
    return (
      <div>
        <div
          style={{
            background: '#fee2e2',
            color: '#b91c1c',
            padding: '0.25rem 0.5rem',
            fontSize: '0.75rem',
            borderRadius: '4px 4px 0 0',
          }}
        >
          Diagram syntax error — {state.message}
        </div>
        <pre
          style={{
            margin: 0,
            padding: '0.5rem',
            background: '#fef2f2',
            borderRadius: '0 0 4px 4px',
            fontSize: '0.8rem',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {state.source}
        </pre>
      </div>
    );
  }

  return (
    <div
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid renders with `securityLevel: 'strict'`; sources are authored Plan content (Dev or local Agent), not arbitrary input. Revisit if Plan content ever comes from anyone other than the connected Agent — `securityLevel: 'strict'` would need re-verification against current mermaid CVEs (CSS `<style>` injection, `xlink:href` data-URIs, etc.) before keeping `dangerouslySetInnerHTML`.
      dangerouslySetInnerHTML={{ __html: state.svg }}
      style={{ lineHeight: 0 }}
    />
  );
}
