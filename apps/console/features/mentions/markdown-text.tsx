'use client';

// Chat-style markdown renderer for Discussion message and Comment reply bodies.
// Shared by both features (the discussion message row and the comment message
// row). Ported from apps/console's MarkdownText, kept on console's
// per-element `components` convention (no Tailwind Typography `prose` plugin is
// installed here — the kit styles each element explicitly).
//
// react-markdown escapes raw HTML by default (no rehype-raw), so allowedElements
// + unwrapDisallowed are the sanitization gate: any construct outside the set
// unwraps to its plain text (a stray `# X` shows the literal X). `tempo-mention`
// is the synthetic element the remark plugin below emits for @mentions; gfm +
// breaks mirror apps/console (the Agent writes lists, bold, tables).

import type { Mention } from '@tempo/contracts';
import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

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

const BASE_PLUGINS = [remarkGfm, remarkBreaks];

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
    <div className={className || undefined}>
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

// `tempo-mention` is a synthetic element the remark plugin emits; it isn't in
// react-markdown's `Components` key union, so the map is cast (apps/console does
// the same). react-markdown still dispatches to it by tag name at runtime.
const COMPONENTS = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del>{children}</del>,
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
    <code className="rounded-xs border border-border bg-code-bg px-[5px] py-[1.5px] font-mono text-[0.86em] text-code-ink">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-sm border border-border bg-code-bg px-3 py-2 font-mono text-[0.86em] text-code-ink">
      {children}
    </pre>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-border-strong border-l-2 pl-3 text-ink-2">
      {children}
    </blockquote>
  ),
  // A wide decision table scrolls instead of overflowing the panel.
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="text-2xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="text-left font-semibold text-ink align-top">{children}</th>,
  td: ({ children }) => <td className="align-top">{children}</td>,
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

function MentionToken({ 'data-label': label }: { 'data-label': string }) {
  return <span className="mention-token">@{label}</span>;
}
