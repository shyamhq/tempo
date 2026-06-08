'use client';

// Client React variant of the `mermaidDiagram` block. Registered in
// `plan-schema-client.ts` for the live editor surface. `@blocknote/react`
// calls `createContext` at module load — so the entire transitive import
// graph from here is client-only. Server uses `mermaid-block.server.ts`.
// Both specs share `mermaid-block-shared.ts` so they agree on type /
// propSchema / content and the PM JSON round-trips byte-for-byte.

import { createReactBlockSpec } from '@blocknote/react';
import {
  MERMAID_BLOCK_TYPE,
  MERMAID_CONTENT,
  MERMAID_PROP_SCHEMA,
  parseMermaidPre,
} from './mermaid-block-shared';
import { MermaidRenderer } from './mermaid-renderer';

export const mermaidBlock = createReactBlockSpec(
  {
    type: MERMAID_BLOCK_TYPE,
    propSchema: MERMAID_PROP_SCHEMA,
    content: MERMAID_CONTENT,
  },
  {
    render: ({ block }) => (
      <div className="bn-mermaid-block" contentEditable={false}>
        <MermaidRenderer source={block.props.source} />
      </div>
    ),

    toExternalHTML: ({ block }) => (
      <pre>
        <code className="language-mermaid" data-language="mermaid">
          {block.props.source}
        </code>
      </pre>
    ),

    parse: (el) => parseMermaidPre(el),

    runsBefore: ['codeBlock'],
  },
);
