'use client';

import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';

// Chat-style surface — no headings. A stray `# X` from the Agent unwraps to
// the literal "X" via DOMPurify's KEEP_CONTENT default; no data loss.
const ALLOWED_TAGS = [
  'p',
  'strong',
  'em',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'br',
  'hr',
];

// marked passes raw HTML through; DOMPurify is the only sanitization gate.
// `target` is excluded to prevent reverse-tabnapping via attacker-authored
// `target="_blank"` without `rel="noopener"`.
const ALLOWED_ATTR = ['href', 'rel'];

const PROSE_CLASS = [
  'reply-md prose prose-sm max-w-none text-ink font-sans',
  'prose-p:text-micro prose-p:font-normal prose-p:leading-[1.55] prose-p:my-1',
  'prose-li:text-micro prose-li:font-normal prose-li:leading-[1.55] prose-li:my-0',
  'prose-ul:my-1 prose-ol:my-1',
  'prose-strong:text-ink prose-strong:font-semibold',
  'prose-code:before:content-none prose-code:after:content-none',
  'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
].join(' ');

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  const raw = marked.parse(text, { breaks: true, gfm: true, async: false });
  if (typeof raw !== 'string') {
    throw new Error('marked.parse returned a Promise; expected synchronous string');
  }
  const html = DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
  return (
    <div
      className={className ? `${PROSE_CLASS} ${className}` : PROSE_CLASS}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify with explicit allow-list immediately above.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
