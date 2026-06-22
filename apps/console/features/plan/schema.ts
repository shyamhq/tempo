'use client';

// The client plan schema for the live BlockNote editor. Mirrors apps/console's
// `planSchemaClient` exactly: the default block / style specs plus the three
// custom blocks (alert, htmlBlock, mermaidDiagram) and the permissive `code`
// style override. The server-safe variant lives in `@tempo/server` and is
// registered on `ServerBlockNoteEditor` for the plan-save path; both schemas
// share each block's `*-shared.ts` type/propSchema/content so PM JSON written
// by the server round-trips here byte-for-byte.
//
// The BlockNote `comment` mark is NOT registered here — it is added to the
// editor's ProseMirror schema via `_tiptapOptions: { extensions: [CommentMark] }`
// at mount (see `components/plan-editor.tsx`), which lets existing comment marks
// in a stored plan parse and render without dragging in the full
// CommentsExtension UI (comment creation / anchors are T4.2).

import { BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from '@blocknote/core';
import { alertBlock } from './blocks/alert-block';
import { htmlBlock } from './blocks/html-block';
import { mermaidBlock } from './blocks/mermaid-block';
import { permissiveCode } from './blocks/permissive-code-style';

export const planSchemaClient = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaidDiagram: mermaidBlock(),
    alert: alertBlock(),
    htmlBlock: htmlBlock(),
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    code: permissiveCode,
  },
});
