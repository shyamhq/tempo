'use client';

import { useOrganization } from '@clerk/nextjs';
import type { Mention } from '@tempo/contracts';
import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { Tooltip } from '@/components/ui/tooltip';

// Chat-style surface — no headings/images. GFM tables are kept (the Agent
// writes decision matrices). Anything outside this set unwraps to its plain
// text via `unwrapDisallowed`, matching the old DOMPurify KEEP_CONTENT default
// (a stray `# X` shows as the literal X). `tempo-mention` is the synthetic
// element the remark plugin below emits for @mentions. react-markdown escapes
// raw HTML by default (no rehype-raw), so it is the sanitization gate.
const ALLOWED_ELEMENTS = [
  'p',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'br',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'tempo-mention',
];

// gfm + breaks mirror the previous `marked.parse(text, { gfm: true, breaks: true })`.
const BASE_PLUGINS = [remarkGfm, remarkBreaks];

const PROSE_CLASS = [
  'reply-md prose prose-sm max-w-none text-ink font-sans',
  'prose-p:text-micro prose-p:font-normal prose-p:leading-[1.55] prose-p:my-1',
  'prose-li:text-micro prose-li:font-normal prose-li:leading-[1.55] prose-li:my-0',
  'prose-ul:my-1 prose-ol:my-1',
  'prose-strong:text-ink prose-strong:font-semibold',
  'prose-code:before:content-none prose-code:after:content-none',
  'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
  'prose-table:text-micro prose-table:my-2 prose-th:text-ink prose-th:font-semibold prose-td:align-top',
].join(' ');

export function MarkdownText({
  text,
  mentions,
  className,
}: {
  text: string;
  mentions?: Mention[] | null;
  className?: string;
}) {
  const remarkPlugins = useMemo(
    () =>
      mentions && mentions.length > 0 ? [...BASE_PLUGINS, remarkMentions(mentions)] : BASE_PLUGINS,
    [mentions],
  );

  return (
    <div className={className ? `${PROSE_CLASS} ${className}` : PROSE_CLASS}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const COMPONENTS = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Wrap so a wide decision table scrolls instead of overflowing the panel.
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  'tempo-mention': MentionToken,
} as Components;

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: unknown };

function remarkMentions(mentions: Mention[]) {
  // Longest label first so "@Alice Chen" is matched before "@Alice".
  const sorted = [...mentions].sort((a, b) => b.label.length - a.label.length);

  const splitText = (value: string): MdNode[] => {
    let nodes: MdNode[] = [{ type: 'text', value }];
    for (const m of sorted) {
      const needle = `@${m.label}`;
      const next: MdNode[] = [];
      for (const n of nodes) {
        if (n.type !== 'text' || !n.value?.includes(needle)) {
          next.push(n);
          continue;
        }
        const parts = n.value.split(needle);
        for (let i = 0; i < parts.length; i++) {
          const piece = parts[i];
          if (piece) next.push({ type: 'text', value: piece });
          if (i < parts.length - 1) {
            next.push({
              type: 'tempoMention',
              data: {
                hName: 'tempo-mention',
                hProperties: { 'data-id': m.id, 'data-kind': m.kind, 'data-label': m.label },
              },
              children: [{ type: 'text', value: `@${m.label}` }],
            });
          }
        }
      }
      nodes = next;
    }
    return nodes;
  };

  const walk = (node: MdNode) => {
    if (!node.children) return;
    const out: MdNode[] = [];
    for (const child of node.children) {
      if (child.type === 'text' && child.value !== undefined) {
        out.push(...splitText(child.value));
      } else {
        walk(child);
        out.push(child);
      }
    }
    node.children = out;
  };

  return () => (tree: MdNode) => walk(tree);
}

// One Clerk subscription per rendered mention token (typically 0-3 per block).
// Clerk dedupes the underlying fetch, so this stays cheaper than subscribing in
// MarkdownText itself, which renders for plenty of mention-free agent messages.
function MentionToken({
  'data-id': id,
  'data-kind': kind,
  'data-label': label,
}: {
  'data-id': string;
  'data-kind': string;
  'data-label': string;
}) {
  const { memberships } = useOrganization({ memberships: true });
  const email =
    kind === 'user'
      ? (memberships?.data?.find((m) => m.publicUserData?.userId === id)?.publicUserData
          ?.identifier ?? null)
      : null;

  const card =
    kind === 'agent' ? (
      <div className="text-caption">
        <div className="font-semibold text-ink">Agent</div>
        <div className="text-ink-tertiary">Tempo planning Agent</div>
      </div>
    ) : (
      <div className="text-caption">
        <div className="font-semibold text-ink">{label}</div>
        {email ? <div className="text-ink-tertiary">{email}</div> : null}
      </div>
    );

  return (
    <Tooltip content={card}>
      <button
        type="button"
        className="mention-token rounded-sm focus-visible:outline-none focus-visible:shadow-focus-soft"
      >
        @{label}
      </button>
    </Tooltip>
  );
}
