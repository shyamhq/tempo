'use client';

// One Discussion message row. Mirrors the kit's `.turn` (Design System Planning
// Tool/ui_kits/workbench/index.html lines 168-178, 477-480): an avatar + author
// name + monospace timestamp head, then the body below. The Agent (author_user_id
// null) renders the ✦ spark on the green-gradient avatar with plain prose; a human
// renders initials on the actor-purple avatar with the inset bubble body.
//
// Presentational: it reads the message it's handed, the current Clerk user (to
// show "You" for the Dev's own posts), and the org's members (to resolve every
// other human author's display name — the same client-side Clerk data the mention
// picker uses, no hand-rolled endpoint). The body renders markdown + @mention
// tokens via the shared MarkdownText. Image attachments render below the body via
// the shared AttachmentStrip (with lightbox).

import { useOrganization, useUser } from '@clerk/nextjs';
import type { DiscussionMessage } from '@tempo/contracts';
import { Avatar } from '@/components/ui/avatar';
import { AttachmentStrip } from '@/features/attachments/components/attachment-strip';
import { MarkdownText } from '@/features/mentions/markdown-text';

type Members = NonNullable<ReturnType<typeof useOrganization>['memberships']>['data'];

function resolveAuthorName(userId: string, members: Members | null | undefined): string {
  const pub = members?.find((m) => m.publicUserData?.userId === userId)?.publicUserData;
  if (!pub) return userId;
  const name = `${pub.firstName ?? ''} ${pub.lastName ?? ''}`.trim();
  return name || pub.identifier || userId;
}

export function DiscussionMessageRow({ message }: { message: DiscussionMessage }) {
  const { user } = useUser();
  const { memberships } = useOrganization({ memberships: true });
  // null author_user_id means the Agent; a non-null id narrows to a human author
  // we resolve a display name for.
  const authorId = message.author_user_id;
  const isAgent = authorId === null;
  const isMine = authorId !== null && authorId === user?.id;
  const resolvedName = authorId === null ? 'Agent' : resolveAuthorName(authorId, memberships?.data);
  // The Dev's own posts read "You"; the avatar still uses the real name so its
  // initial isn't a stray "Y".
  const name = isMine ? 'You' : resolvedName;
  const avatarName = isMine ? (user?.fullName ?? user?.username ?? resolvedName) : resolvedName;
  const text = message.text ?? '';

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 pt-3 pb-[14px] first:border-t-0">
      <div className="flex items-center gap-2 text-[11.5px]">
        <Avatar name={avatarName} kind={isAgent ? 'agent' : 'user'} size={19} />
        <span className="font-semibold text-ink">{name}</span>
        <time
          dateTime={message.created_at}
          suppressHydrationWarning
          className="ml-auto font-mono text-[10px] text-ink-3 tabular-nums"
        >
          {new Date(message.created_at).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>
      {text.length > 0 || message.attachments.length > 0 ? (
        <div
          className={
            isAgent
              ? 'break-words text-[12.5px] leading-[1.6] text-ink'
              : 'break-words rounded-[11px] border border-border bg-inset px-[13px] py-[10px] text-[12.5px] leading-[1.6] text-ink'
          }
        >
          {text.length > 0 ? <MarkdownText text={text} mentions={message.mentions} /> : null}
          <AttachmentStrip attachments={message.attachments} />
        </div>
      ) : null}
    </div>
  );
}
