// Server-safe `htmlBlock` spec. Registered in `plan-schema.ts` so
// `ServerBlockNoteEditor` (jsdom) can parse Agent HTML containing
// `<pre><code class="language-html-block">…</code></pre>` into a structured
// block, and emit the same fence back when serialising to external HTML
// (markdown export — keeps the source readable instead of a nested iframe).
//
// `render` is never invoked server-side — ServerBlockNoteEditor only uses
// the schema for ProseMirror schema construction, parsing, and JSON
// transforms. The stub render exists to satisfy the BlockSpec contract.
//
// HTML source lives on `props.html` (see `html-block-shared.ts` for why we
// don't use `content: 'inline'`). `toExternalHTML` writes the html as the
// `<code>` text content; `parse` reads it back the same way.

import { createBlockSpec } from '@blocknote/core';
import {
  HTML_BLOCK_TYPE,
  HTML_CONTENT,
  HTML_PROP_SCHEMA,
  parseHtmlBlockPre,
} from './html-block-shared';

export const htmlBlockServer = createBlockSpec(
  {
    type: HTML_BLOCK_TYPE,
    propSchema: HTML_PROP_SCHEMA,
    content: HTML_CONTENT,
  },
  {
    render: () => {
      const pre = document.createElement('pre');
      pre.className = 'bn-html-block';
      return { dom: pre };
    },

    toExternalHTML: (block) => {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-html-block';
      code.dataset.language = 'html-block';
      code.textContent = block.props.html;
      pre.appendChild(code);
      return { dom: pre };
    },

    parse: parseHtmlBlockPre,

    runsBefore: ['codeBlock'],
  },
);
