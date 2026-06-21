'use client';

// The single seam the plan editor splices in for the comment PRESENTATION
// layer. The plan editor disables BlockNote's stock comments UI
// (`comments={false}` on BlockNoteView) and instead renders:
//
//   <CommentControllers />  — inside BlockNoteView: the floating new-comment
//     composer (on selection) and the floating thread card (on a focused
//     highlight), both hosted by BlockNote's documented controllers with our
//     kit-styled components. Positioning stays BlockNote's — anchored on the
//     selected/pending text, matching the kit's popover placement.
//
//   <CommentGutter />       — beside the doc column: the margin rail of markers.
//
// The new-comment affordance is the stock AddCommentButton in the formatting
// toolbar (it fires startPendingComment, which CommentControllers' composer then
// renders) — the kit's on-selection "Comment" action.

import { CommentsExtension } from '@blocknote/core/comments';
import {
  FloatingComposerController,
  FloatingThreadController,
  type FloatingUIOptions,
  useBlockNoteEditor,
} from '@blocknote/react';
import { CommentCard } from './comment-card';
import { CommentComposer } from './comment-composer';

export { CommentGutter } from './comment-gutter';

// BlockNote's stock controllers close the popover on ANY floating-ui dismiss
// reason (including focus leaving the card after a post) and re-focus the editor
// on close — which both closes the card on submit and scrolls the editor's
// contenteditable back to the top. Override onOpenChange so a post keeps the card
// open: dismiss ONLY on an explicit outside press or Escape, and never call
// editor.focus() (the source of the scroll-to-top). The thread card's open state
// is BlockNote's selectedThreadId; the composer's is its pendingComment flag.
function dismissedByUser(reason: string | undefined): boolean {
  return reason === 'outside-press' || reason === 'escape-key';
}

export function CommentControllers() {
  const editor = useBlockNoteEditor();
  const ext = editor.getExtension(CommentsExtension);

  const composerOptions: FloatingUIOptions = {
    useFloatingOptions: {
      onOpenChange: (open, _event, reason) => {
        if (!open && dismissedByUser(reason)) ext?.stopPendingComment();
      },
    },
  };
  const threadOptions: FloatingUIOptions = {
    useFloatingOptions: {
      onOpenChange: (open, _event, reason) => {
        if (!open && dismissedByUser(reason)) ext?.selectThread(undefined);
      },
    },
  };

  return (
    <>
      <FloatingComposerController
        floatingComposer={CommentComposer}
        floatingUIOptions={composerOptions}
      />
      <FloatingThreadController floatingThread={CommentCard} floatingUIOptions={threadOptions} />
    </>
  );
}
