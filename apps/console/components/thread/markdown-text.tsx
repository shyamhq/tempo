'use client';

import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';

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
  'h1',
  'h2',
  'h3',
  'h4',
];

// marked passes raw HTML through; DOMPurify is the only sanitization gate.
// `target` is excluded to prevent reverse-tabnapping via attacker-authored
// `target="_blank"` without `rel="noopener"`.
const ALLOWED_ATTR = ['href', 'rel'];

const PROSE_CLASS = [
  'reply-md prose prose-sm max-w-none text-ink font-sans',
  'prose-headings:font-semibold prose-headings:text-ink prose-headings:tracking-tight',
  'prose-h1:text-[1.0625rem] prose-h1:mb-1.5 prose-h1:mt-3 first:prose-h1:mt-0',
  'prose-h2:text-[1rem] prose-h2:mb-1 prose-h2:mt-2.5',
  'prose-h3:text-[0.9375rem] prose-h3:mb-1 prose-h3:mt-2',
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
