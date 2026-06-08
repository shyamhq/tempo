'use client';

// Client variant of `planSchema`. Identical to the server-safe `planSchema`
// in every block / inline-content / style spec EXCEPT `mermaidDiagram`, which
// is registered via `createReactBlockSpec` so the live editor can render
// the diagram as SVG with hooks. The two schemas share the mermaidDiagram
// type / propSchema / content via `./blocks/mermaid-block-shared.ts` and the
// `code` style override via `./permissive-code-style.ts`, so PM JSON written
// by the server (using `planSchema`) loads cleanly here.
//
// Import this from any client-side editor surface (PlanEditor, the playground
// route). Importing it from a server module would fail the same way
// `@blocknote/react` does — it calls `createContext` at load.

import { BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from '@blocknote/core';
import { alertBlock } from './blocks/alert-block';
import { mermaidBlock } from './blocks/mermaid-block';
import { permissiveCode } from './permissive-code-style';

export const planSchemaClient = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaidDiagram: mermaidBlock(),
    alert: alertBlock(),
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    code: permissiveCode,
  },
});
