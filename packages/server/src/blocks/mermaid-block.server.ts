// Server-safe `mermaidDiagram` block spec. Registered in `plan-schema.ts`
// so `ServerBlockNoteEditor` (jsdom) can parse Agent HTML containing
// `<pre><code class="language-mermaid">…</code></pre>` into a structured
// block, and emit the same fence back when serialising to external HTML
// (markdown export).
//
// `render` is never invoked server-side — ServerBlockNoteEditor only uses
// the schema for ProseMirror schema construction, parsing, and JSON
// transforms. The stub render exists to satisfy the BlockSpec contract.

import { createBlockSpec } from '@blocknote/core';
import {
  MERMAID_BLOCK_TYPE,
  MERMAID_CONTENT,
  MERMAID_PROP_SCHEMA,
  parseMermaidPre,
} from './mermaid-block-shared';

export const mermaidBlockServer = createBlockSpec(
  {
    type: MERMAID_BLOCK_TYPE,
    propSchema: MERMAID_PROP_SCHEMA,
    content: MERMAID_CONTENT,
  },
  {
    render: () => {
      const dom = document.createElement('div');
      dom.className = 'bn-mermaid-block';
      return { dom };
    },

    toExternalHTML: (block) => {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-mermaid';
      code.dataset.language = 'mermaid';
      code.textContent = (block.props as { source: string }).source;
      pre.appendChild(code);
      return { dom: pre };
    },

    parse: parseMermaidPre,

    runsBefore: ['codeBlock'],
  },
);
