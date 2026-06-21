'use client';

// The live BlockNote plan editor. Mounted client-only (the route imports this
// via next/dynamic with ssr:false, as BlockNote requires). It is presentational
// in the Tempo sense: it reads the plan body from the plan slice and persists
// edits through `features/plan/api.ts` — it never calls fetch or validates a
// wire shape itself.
//
// Load: the plan body (PM JSON) is hydrated into the slice before this mounts.
// We seed the editor from `plan.body.pm_json` the first time it is available and
// re-apply it whenever the slice's body changes to a value the editor did not
// itself just save — that single rule covers both the initial load and the
// live-reload from an Agent edit (the gateway refetches the body on plan_edited
// and writes it to the slice via useThreadSession's onPlanEdited).
//
// Save: a Dev edit fires the editor's onChange, which debounces a save. The save
// snapshots the editor's ProseMirror JSON (PM JSON, not the blocks projection —
// the blocks projection drops `comment` marks), writes it optimistically to the
// slice, then POSTs to the Worker. The Worker stamps Dev-vs-Agent attribution
// server-side (browser caller → Dev user id; Agent → null) and emits a
// plan_edited event the gateway echoes back.
//
// Comments: the `comment` mark is registered on the ProseMirror schema via
// `_tiptapOptions` so existing comment marks in a stored plan parse and render.
// Comment creation, anchors, and the comment card/gutter are T4.2 / T4.3 — not
// wired here.

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

import { CommentMark } from '@blocknote/core/comments';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import {
  blockTypeSelectItems,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { useAuth } from '@clerk/nextjs';
import type { PlanBody } from '@tempo/contracts';
import { useCallback, useEffect, useRef } from 'react';
import { usePlan, useThreadStore } from '@/store';
import { writePlan } from '../api';
import { alertBlockTypeItems, alertSlashItems } from '../blocks/alert-block';
import { htmlBlockTypeItem, htmlSlashItem } from '../blocks/html-block';
import { planSchemaClient } from '../schema';
import { usePlanAutoSave } from '../use-plan-auto-save';

export function PlanEditor({ threadId }: { threadId: string }) {
  const { getToken } = useAuth();
  const plan = usePlan();
  const body = plan.body;

  // Register the comment mark on the ProseMirror schema (mark-only, no
  // CommentsExtension UI) so stored comment marks parse and render. The full
  // comments integration is T4.2.
  const editor = useCreateBlockNote({
    schema: planSchemaClient,
    _tiptapOptions: { extensions: [CommentMark] },
  });

  // The PM JSON the editor currently holds, as a string, so we can tell an
  // external body change (initial load / Agent edit) apart from the echo of our
  // own save. Updated both when we apply an incoming body and when we snapshot
  // for a save.
  const appliedJsonRef = useRef<string | null>(null);
  // Gates the save loop until the initial seed has run, so an onChange fired
  // while the editor is still showing its empty mount document can't schedule a
  // save of an empty plan over the body that is about to load.
  const seededRef = useRef(false);

  // Persist: optimistic slice write, then the Worker POST. Throwing on failure
  // lets the auto-save hook drive its backoff. The optimistic write keeps the
  // slice (and thus appliedJsonRef on the next render) in lock-step with what we
  // sent, so the plan_edited echo's refetch is a no-op re-apply.
  const persist = useCallback(
    async (pmJson: unknown) => {
      appliedJsonRef.current = JSON.stringify(pmJson);
      const prev = useThreadStore.getState().plan.body;
      if (prev) {
        const optimistic: PlanBody = { ...prev, pm_json: pmJson };
        useThreadStore.getState().setPlan({ body: optimistic });
      }
      await writePlan(threadId, { pm_json: pmJson }, getToken);
    },
    [threadId, getToken],
  );

  const { notifyEdit } = usePlanAutoSave({
    // PM JSON (not the blocks projection) is the at-rest format: the blocks
    // projection drops `blocknoteIgnore` marks (comments), PM JSON preserves
    // them.
    getPmJson: () => editor._tiptapEditor.getJSON(),
    persist,
  });

  // Seed on first availability and re-apply on external body changes (Agent
  // edits). `emitUpdate: false` suppresses onChange so a load never masquerades
  // as a Dev edit. We compare the serialized body against what the editor last
  // applied/saved so the Dev's own save echo doesn't re-apply (which would jump
  // the cursor).
  useEffect(() => {
    if (!body) return;
    const incoming = JSON.stringify(body.pm_json);
    if (incoming === appliedJsonRef.current) return;
    appliedJsonRef.current = incoming;
    editor._tiptapEditor.commands.setContent(body.pm_json as never, { emitUpdate: false });
    // Open the save loop ONLY after real content is seeded. Before this the editor
    // holds its empty mount document; an onChange then would debounce a save of an
    // empty plan over the body that is still loading — corrupting the stored plan.
    seededRef.current = true;
  }, [editor, body]);

  return (
    <div className="mx-auto w-full max-w-[var(--tp-container-doc)] px-6 py-10" data-plan-column>
      <BlockNoteView
        editor={editor}
        comments={false}
        formattingToolbar={false}
        slashMenu={false}
        theme="light"
        onChange={() => {
          if (!seededRef.current) return;
          notifyEdit();
        }}
      >
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar
              blockTypeSelectItems={[
                ...blockTypeSelectItems(editor.dictionary),
                ...alertBlockTypeItems,
                htmlBlockTypeItem,
              ]}
            />
          )}
        />
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [
                ...getDefaultReactSlashMenuItems(editor),
                ...alertSlashItems(editor),
                htmlSlashItem(editor),
              ],
              query,
            )
          }
        />
      </BlockNoteView>
    </div>
  );
}
