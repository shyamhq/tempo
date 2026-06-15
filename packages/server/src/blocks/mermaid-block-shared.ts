// Shared shape for the mermaidDiagram block — used by both the server-safe
// vanilla spec (`mermaid-block.server.ts`, registered in `plan-schema.ts`)
// and the client React spec (`mermaid-block.tsx`, registered in
// `plan-schema-client.ts`). Both schemas must agree on type / propSchema /
// content for PM JSON to round-trip, so we host the agreement here.
//
// If you add a prop to the mermaidDiagram block, change
// `MERMAID_PROP_SCHEMA` here — never in one spec file only. Both specs
// import from this file, so adding a prop in only one will silently break
// the PM JSON wire format between server writes and client renders.

export const MERMAID_BLOCK_TYPE = 'mermaidDiagram' as const;

export const MERMAID_PROP_SCHEMA = {
  source: { default: '' as string },
} as const;

export const MERMAID_CONTENT = 'none' as const;

// Claims `<pre><code class="language-mermaid">…</code></pre>` (also accepts
// `data-language="mermaid"`). Returns the source text, or undefined to let
// codeBlock handle the element.
export function parseMermaidPre(el: HTMLElement): { source: string } | undefined {
  if (el.tagName !== 'PRE') return undefined;
  const code = el.querySelector('code');
  if (!code) return undefined;
  const hasMermaidClass = code.classList.contains('language-mermaid');
  const hasMermaidAttr = code.getAttribute('data-language') === 'mermaid';
  if (!hasMermaidClass && !hasMermaidAttr) return undefined;
  return { source: code.textContent ?? '' };
}
