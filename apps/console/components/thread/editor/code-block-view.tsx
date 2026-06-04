'use client';

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useEffect, useId, useState } from 'react';

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

export function CodeBlockView({ node }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? null;
  const isMermaid = language === 'mermaid';
  const source = node.textContent;
  const idSeed = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isMermaid) return;
    if (!source.trim()) {
      setSvg(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        const { svg: rendered } = await mermaid.render(`mmd-${idSeed}`, source);
        if (cancelled) return;
        setSvg(rendered);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setSvg(null);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [isMermaid, source, idSeed]);

  // Keep the source chrome in the DOM (just hidden via CSS) so ProseMirror's
  // NodeViewContent stays reachable for delete/merge from adjacent blocks.
  const rendered = isMermaid && svg !== null && !error;

  return (
    <NodeViewWrapper
      as="div"
      className="confluence-code-block"
      data-language={language ?? ''}
      data-rendered={rendered ? 'true' : undefined}
    >
      {rendered ? (
        <div className="mermaid-preview" contentEditable={false}>
          <div
            className="mermaid-preview__svg"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid sanitizes the SVG via DOMPurify (ADD_TAGS: foreignobject) before render() returns; securityLevel:'strict' routes through that branch. Source is the Plan body written by the local Agent, not multi-tenant input.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      ) : null}
      {isMermaid && error ? (
        <div className="mermaid-preview" contentEditable={false}>
          <div className="mermaid-preview__error">Diagram error: {error}</div>
        </div>
      ) : null}
      <div className="confluence-code-block__chrome">
        <div className="confluence-code-block__header">{language ?? 'Code'}</div>
        <pre className="confluence-code-block__pre">
          <NodeViewContent<'code'>
            as="code"
            className={language ? `language-${language}` : undefined}
          />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}
