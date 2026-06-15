// Shared shape for the htmlBlock — used by both the server-safe vanilla spec
// (`html-block.server.ts`, registered in `plan-schema.ts`) and the client
// React spec (`html-block.tsx`, registered in `plan-schema-client.ts`). Both
// schemas must agree on type / propSchema / content / parse for PM JSON to
// round-trip, so we host the agreement here.
//
// HTML wire shape is `<pre><code class="language-html-block">…verbatim html…</code></pre>`
// (the same code-fence pattern mermaid uses with a different language class).
// This is the contract with the Agent (see `apps/agent/src/mcp-server.ts`
// tool descriptions) and with stored PM JSON — it cannot change once shipped.
//
// The HTML source is stored on `props.html`, not as BlockNote inline content.
// We tried `content: 'inline'` (codeBlock-style) first; PM normalised the
// multi-line text — splitting at `\n`, dropping nodes — and Ctrl+A inside
// the source surface escaped the block and selected the whole document.
// A prop + Dev-owned `<textarea>` source view keeps raw HTML lossless and
// scopes selection to the block.

export const HTML_BLOCK_TYPE = 'htmlBlock' as const;

export const HTML_PROP_SCHEMA = {
  html: { default: '' as string },
  // 0 means "auto-grow from iframe-reported content height, capped at CAP".
  // A non-zero value means the Dev resized via the bottom-edge handle and
  // the renderer should lock to that pixel height instead.
  height: { default: 0 as number },
} as const;

export const HTML_CONTENT = 'none' as const;

// Claims `<pre><code class="language-html-block">…</code></pre>` (also accepts
// `data-language="html-block"`). Returns `{ html }` recovered from the matched
// `<code>` so the Agent's serialized HTML round-trips into the block's `html`
// prop on parse — works whether the Agent entity-escaped the inner markup or
// emitted it raw.
export function parseHtmlBlockPre(el: HTMLElement): { html: string } | undefined {
  if (el.tagName !== 'PRE') return undefined;
  const code = el.querySelector('code');
  if (!code) return undefined;
  if (
    !code.classList.contains('language-html-block') &&
    code.getAttribute('data-language') !== 'html-block'
  )
    return undefined;
  // Raw markup got parsed into DOM children — `textContent` would strip the
  // tags, so we re-serialise via `innerHTML` (which may HTML5-normalise edge
  // structures, e.g. `<tbody>` injection, `<p>` reparenting; `props.html` is
  // the normalised form thereafter, not a lossless copy of Agent source).
  return {
    html: code.children.length === 0 ? (code.textContent ?? '') : code.innerHTML,
  };
}
