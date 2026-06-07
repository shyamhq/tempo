import {
  type Block,
  BlockNoteSchema,
  createStyleSpecFromTipTapMark,
  defaultStyleSpecs,
} from '@blocknote/core';

// The single source of schema truth for the Plan editor. Imported by:
//   - the client editor surface (useCreateBlockNote)
//   - the server-side encoder/decoder (ServerBlockNoteEditor.create)
// Both sides must agree byte-for-byte on which block, inline-content, and
// style specs are registered, or the wire format drifts.
//
// We use BlockNote's default schema with ONE override: the `code` style spec.
// See `permissiveCode` below for the reason.

// ---------------------------------------------------------------------------
// UPSTREAM-WATCH — BlockNote #2795 + TipTap default
//
// TipTap's `Code` mark is declared with `excludes: '_'` (wildcard), so no
// other inline mark can coexist with it on the same text run. This blocks
// the BlockNote CommentsExtension from stamping a `comment` mark on inline
// code: ProseMirror silently refuses the setMark call. Symptoms: commenting
// on inline code produces a saved Comment row with no visible highlight; a
// mixed selection (text + `code` + text) only highlights the non-code spans.
//
// Filed against BlockNote at https://github.com/TypeCellOS/BlockNote/issues/2795
// (open as of 2026-06-07, labelled bug:P3, a contributor has expressed
// interest). Upstream root cause documented at
// https://github.com/ueberdosis/tiptap/issues/2563.
//
// Workaround below: pluck the Code mark BlockNote already extended (with
// the backtick input rules), re-extend with `excludes: ''`, rebuild the
// style spec, and register it in place of the default. Same fix the
// BlockNote PR will eventually ship.
//
// Revisit: 2026-12 (~6 months out). If #2795 has merged, delete the
// `permissiveCode` block below and pass no `styleSpecs` to
// `BlockNoteSchema.create()` — the upstream default will be the same.
// AGENTS.md "Upstream watches" tracks this for periodic review.
// ---------------------------------------------------------------------------

const permissiveCode = createStyleSpecFromTipTapMark(
  defaultStyleSpecs.code.implementation.mark.extend({ excludes: '' }),
  'boolean',
);

export const planSchema = BlockNoteSchema.create({
  styleSpecs: {
    ...defaultStyleSpecs,
    code: permissiveCode,
  },
});

export type PlanBlock = Block;
