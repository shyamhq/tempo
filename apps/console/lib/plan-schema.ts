import { type Block, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from '@blocknote/core';
import { CommentMark } from '@blocknote/core/comments';
import { alertBlockServer } from './blocks/alert-block.server';
import { mermaidBlockServer } from './blocks/mermaid-block.server';
import { permissiveCode } from './permissive-code-style';

// Server-safe schema. The single source of schema truth for the Plan editor
// when imported server-side (from `apps/console/server/plan/block-html.ts`
// → `ServerBlockNoteEditor`). The `mermaidDiagram` block is registered via
// the vanilla `createBlockSpec` variant so this module does not pull in
// `@blocknote/react`, which calls `createContext` at module load and fails
// in a React Server Component module. The client editor surface imports
// `planSchemaClient` from `./plan-schema-client.ts` for the React-rendering
// variant. Both schemas share type / propSchema / content via
// `./blocks/mermaid-block-shared.ts` and the `code` style override via
// `./permissive-code-style.ts` so PM JSON round-trips byte-for-byte.
export const planSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaidDiagram: mermaidBlockServer(),
    alert: alertBlockServer(),
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    code: permissiveCode,
  },
});

// BlockNote's `comment` mark, exported from `@blocknote/core/comments`. The
// client editor's CommentsExtension wires this mark plus UI plugin behavior;
// the server-side ServerBlockNoteEditor only needs the mark spec registered
// on its ProseMirror schema so prosemirror-model can parse pm_json that
// contains comment marks. We re-export from here so the server path has a
// single import point alongside `planSchema`.
export { CommentMark };

export type PlanBlock = Block;
