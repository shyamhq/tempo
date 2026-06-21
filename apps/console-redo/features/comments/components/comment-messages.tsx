'use client';

// The message rows inside a thread card. Each row is one BlockNote CommentData
// (a Tempo Reply, or the synthesised anchor message for an empty thread).
// Mirrors the kit's `.cmt` row (Design System Planning Tool/ui_kits/workbench/
// index.html lines 217-223): an avatar, the author name, a timestamp, then the
// body indented under the avatar.
//
// Author display resolves through BlockNote's documented useUser hook, which
// reads the same resolveUsers callback the editor was built with (Clerk member
// name, or "Agent" for the AGENT_AUTHOR_ID sentinel) — no second lookup.

import type { CommentData } from '@blocknote/core/comments';
import { useUser } from '@blocknote/react';
import { Avatar } from '@/components/ui/avatar';
import { commentText, formatTime } from '../comment-text';
import { AGENT_AUTHOR_ID } from '../comment-thread-store';

export function CommentMessages({ comments }: { comments: readonly CommentData[] }) {
  return (
    <>
      {comments.map((comment) => (
        <CommentMessageRow key={comment.id} comment={comment} />
      ))}
    </>
  );
}

function CommentMessageRow({ comment }: { comment: CommentData }) {
  const isAgent = comment.userId === AGENT_AUTHOR_ID;
  const user = useUser(comment.userId);
  const name = isAgent ? 'Agent' : (user?.username ?? comment.userId);
  const text = commentText(comment.body);

  return (
    <div className="mb-3 flex flex-col gap-[5px]">
      <div className="flex items-center gap-[7px]">
        <Avatar name={name} kind={isAgent ? 'agent' : 'user'} size={20} />
        <span className="font-sans text-sm font-semibold text-ink">{name}</span>
        <span className="font-mono text-2xs text-ink-3 tabular-nums">
          {formatTime(comment.createdAt)}
        </span>
      </div>
      {text.length > 0 ? (
        <p className="whitespace-pre-wrap break-words pl-[27px] font-sans text-sm leading-body text-ink-2">
          {text}
        </p>
      ) : (
        <p className="pl-[27px] font-sans text-sm italic text-ink-3">(deleted)</p>
      )}
    </div>
  );
}
