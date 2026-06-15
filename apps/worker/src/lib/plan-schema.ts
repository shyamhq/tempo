import { type Block, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from '@blocknote/core';
import { CommentMark } from '@blocknote/core/comments';
import { alertBlockServer } from './blocks/alert-block.server';
import { htmlBlockServer } from './blocks/html-block.server';
import { mermaidBlockServer } from './blocks/mermaid-block.server';
import { permissiveCode } from './permissive-code-style';

// Server-safe plan schema for the Worker. Mirrors Console's plan-schema.ts
// exactly — both must agree on block types / propSchemas / content so PM JSON
// written by the Agent round-trips cleanly in the Console editor.
export const planSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaidDiagram: mermaidBlockServer(),
    alert: alertBlockServer(),
    htmlBlock: htmlBlockServer(),
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    code: permissiveCode,
  },
});

export { CommentMark };

export type PlanBlock = Block;
