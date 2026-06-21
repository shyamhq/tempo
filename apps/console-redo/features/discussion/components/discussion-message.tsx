'use client';

// One Discussion message row. Mirrors the kit's `.turn` (Design System Planning
// Tool/ui_kits/workbench/index.html lines 168-178, 477-480): an avatar + author
// name + monospace timestamp head, then the body below. The Agent (author_user_id
// null) renders the ✦ spark on the green-gradient avatar with plain prose; a human
// renders initials on the actor-purple avatar with the inset bubble body.
//
// Presentational: it reads the message it's handed and the current Clerk user (to
// show "You" for the Dev's own posts). Image attachments render below the body via
// the shared AttachmentStrip (with lightbox). Question-carrying and
// Agent-attribution rows are still deferred.

import { useUser } from '@clerk/nextjs';
import type { DiscussionMessage } from '@tempo/contracts';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { Avatar } from '@/components/ui/avatar';
import { AttachmentStrip } from '@/features/attachments/components/attachment-strip';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Token-styled markdown body, matching the kit's `.turn .body` (12.5px / 1.6).
// gfm + breaks mirror the sibling's MarkdownText so the Agent's lists, bold, and
// inline code render the same. Mentions are still deferred, so no mention remark
// plugin here.
const BODY_PLUGINS = [remarkGfm, remarkBreaks];

const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded border border-border bg-[var(--tp-code-bg)] px-[5px] py-[1.5px] font-mono text-[0.86em] text-[var(--tp-code-ink)]">
      {children}
    </code>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
};

function MessageMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={BODY_PLUGINS} components={MD_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

export function DiscussionMessageRow({ message }: { message: DiscussionMessage }) {
  const { user } = useUser();
  const isAgent = message.author_user_id === null;
  const isMine = !isAgent && message.author_user_id === user?.id;
  const name = isAgent ? 'Agent' : isMine ? 'You' : 'Member';
  const text = message.text ?? '';

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 pt-3 pb-[14px] first:border-t-0">
      <div className="flex items-center gap-2 text-[11.5px]">
        <Avatar
          name={isMine && user?.username ? user.username : name}
          kind={isAgent ? 'agent' : 'user'}
          size={19}
        />
        <span className="font-semibold text-ink">{name}</span>
        <time
          dateTime={message.created_at}
          suppressHydrationWarning
          className="ml-auto font-mono text-[10px] text-ink-3 tabular-nums"
        >
          {formatTime(message.created_at)}
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
          {text.length > 0 ? <MessageMarkdown text={text} /> : null}
          <AttachmentStrip attachments={message.attachments} />
        </div>
      ) : null}
    </div>
  );
}
