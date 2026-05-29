# Markdown rendering for Comment replies + short-reply Agent guidance

## Problem

Two distinct issues, both visible in the Thread view today:

1. **Replies render raw markdown.** A reply containing `**bold**`, `` `inline code` ``, fenced ```` ``` ```` blocks, or `1. numbered` lists is rendered as a single block of pre-wrapped plain text. Backticks and asterisks are visible as literal characters. The Plan editor next to it renders the same syntax correctly, so the visual mismatch is jarring.
2. **Agent replies are verbose.** The Agent currently dumps the entire verification log into a single reply — multi-paragraph step-by-step transcripts. The Dev's stated mental model is "designer responding to a PM in Figma": short, what-I-did + why + the takeaway. Long transcripts belong in the Agent's own session, not in the rail.

## Smallest concrete change

1. **Markdown renderer module** at `apps/console/components/thread/markdown-text.tsx`, marked `'use client'`. Single export `MarkdownText({ text, className? })`:
   - Imports `marked` and `isomorphic-dompurify` (already installed: `marked@18.0.4`, `isomorphic-dompurify@3.15.0`).
   - `marked.parse(text, { breaks: true, gfm: true })` → HTML.
   - `DOMPurify.sanitize(html, { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...] })` with an explicit allow-list (see Uncertainties for the list) — defense-in-depth, since DB replies are plain markdown strings stored without any write-time sanitization.
   - Render in a `<div className="reply-md prose prose-sm max-w-none …">` using the **same Tailwind typography classes** used by the Plan editor's `DEFAULT_EDITOR_CLASS` (excluding `min-h-[60vh]` and `focus:outline-none`). The `.reply-md` scope (added in step 2) styles the raw HTML tags `marked` emits (`code`, `pre > code`); we do **not** try to reuse `.plan-editor-dense` because its selectors are anchored on `.ProseMirror` children, which `marked`'s output does not produce.
2. **`globals.css` — new `.reply-md` scope** mirroring the Confluence-style inline-code and fenced-block visuals from `.plan-editor-dense`, but with selectors that match `marked`'s raw HTML output:
   - `.reply-md code` (covers inline `<code>` directly under any parent — `marked` does not wrap inline code in any container) → background `#f4f5f7`, no border, 13px, normal weight (matches the inline-code styling we already use in the Plan editor).
   - `.reply-md pre` (fenced blocks → marked emits `<pre><code>`) → same background, padding, mono font, 13px.
   - `.reply-md pre > code` → `background: transparent` to avoid double-painting.
   - Inline-code rule must include `:not(pre) > code` style restriction so the inline rule doesn't bleed into fenced blocks.
3. **`comment-cards.tsx`**: replace the `<p className="text-xs text-ink whitespace-pre-wrap">{text}</p>` in `ReplyRow` with `<MarkdownText text={text} />`. Keep the `whitespace-pre-wrap` fallback for the two non-text reply payload variants (`edit_proposed.replacement`, the rejection-reason line) — those are code snippets where markdown parsing would hurt, not help.
4. **Composer stays plain.** The Dev's reply Textarea is unchanged: plain `textarea`. If the Dev types markdown, it renders as markdown after submit. (Slack/GitHub-equivalent UX.)
5. **Agent prompt update** in `apps/console/server/initial-prompt.ts`:
   - Insert a "Reply style" section under the existing "Tools" / "Polling loop" structure that says, in the Dev's words: reply like a designer telling a PM what was changed and why — short summary, what you verified or applied, the one takeaway. **Three short paragraphs at most.** No step-by-step transcripts, no full verification logs (those belong in the Agent's own session). Use markdown for inline code references and short bullet lists; avoid long fenced code blocks unless the snippet *is* the answer.
   - One concrete example pair in the prompt: a bloated reply (current behavior) and the same content as a short reply. Showing > telling.

## Alternatives considered

**Option A (chosen) — light `marked` + `DOMPurify`, render into a Tailwind `prose` div.**
- Pro: minimal cost per reply (string transform, one DOM tree per render).
- Pro: matches Plan typography by sharing the same `prose-*` utilities.
- Pro: sanitization is a one-line concern at the boundary.
- Con: not pixel-identical to Tiptap's render (e.g., link styles, table layout) — for the marker set actually used (bold, italic, inline code, fenced code, lists, headings, links) this is good enough.

**Option B — read-only Tiptap per reply with the same extensions as the Plan editor.**
- Pro: literal pixel match with the Plan.
- Con: one editor instance per reply on every render of the rail. The Plan rail can hold dozens of replies; this would be wasteful and add measurable mount cost.
- Con: dragging in Tiptap state machinery for what is fundamentally a static render.
- Rejected.

**Option C — store rendered HTML on the server.**
- Pro: zero client-side cost.
- Con: HTML in the DB is harder to migrate later than markdown text. The current contract field is `text: string` and stays that way; rendering is a presentation concern.
- Rejected.

**Option D for #2 — server-side hard cap on reply length (e.g. 600 chars).**
- Pro: forces brevity.
- Con: clips genuinely useful long replies (e.g., the *one* snippet that *is* the answer); produces awkward truncation; gives the Dev no signal about why the Agent's reply was cut.
- Con: schema change (`CreateReplyRequest`) for a behavioral problem that prompt-tuning can solve.
- Rejected — start with prompt-only; revisit if Agent ignores guidance.

**Option E for #2 — separate `summary` and `detail` payload variants.**
- Pro: Dev can drill into the full log on demand.
- Con: contract change, UI change, behavioral change. Premature seam — adding payload variants for a problem we haven't yet validated requires multiple Devs to want.
- Rejected.

## Layer placement (rule 19)

| Item | Layer |
|---|---|
| `MarkdownText` component | `apps/console/components/thread/markdown-text.tsx` (UI). Pure render; no business rules, no DB, no HTTP. |
| `comment-cards.tsx` change | UI. Swaps one render line. |
| `globals.css` — adds a `.reply-md` (or `.plan-editor-dense`-equivalent) selector for inline-code + fenced code in the reply container | CSS layer. Mirrors existing rules. |
| `initial-prompt.ts` update | `apps/console/server/initial-prompt.ts` (server module that ships text to the Agent). Unchanged layer. |

No new files in `server/`. No new routes. No DB or contract changes. No new MCP tool.

## Deletion test (CONTEXT.md §2)

- **`MarkdownText` component**: if we deleted it in 6 months, every `ReplyRow` would either (a) revert to raw text — the visible bug we're fixing — or (b) inline `marked.parse(...)` calls would scatter through the UI. Each new inline call would also need sanitization, and inconsistent typography styling. The complexity reappears, multiplied. **Module justified.**
- **`.reply-md` CSS scope**: if deleted, the inline-code and fenced-code visuals in replies revert to browser defaults (Times-style serif for `<code>`, no background, hairline border on `<pre>`). Replaced by either copy-paste of the rules into a different scope or a Tailwind-only treatment that doesn't read as code. Complexity reappears. **Scope justified.**

## Uncertainties

- **Marked configuration**: `breaks: true` makes a single newline an HTML `<br>` (GitHub-flavor short-form). That matches what the Dev expects when typing in a textarea. If the Agent posts canonical markdown (where paragraphs require a blank line), `breaks: true` may produce extra `<br>` inside intentional paragraphs. Will eyeball on first render and switch off if it's wrong.
- **DOMPurify `ALLOWED_TAGS` allow-list**: starting set, derived from the markers we expect Agent + Dev to actually use: `p, strong, em, code, pre, ul, ol, li, blockquote, a, br, hr, h1, h2, h3, h4`. `ALLOWED_ATTR`: `href, target, rel` for `<a>`; nothing for the rest. Explicitly blocks `<img>`, `<script>`, `<style>`, `<iframe>`, inline `style=`, all event handlers. The `marked` defaults emit nothing outside this list for the marker subset we expect; the allow-list is belt-and-suspenders.
- **`MarkdownText` is client-only**: marked `'use client'`. `isomorphic-dompurify` ships a Node JSDOM adapter that is auto-loaded when imported in a Node runtime, but we are deliberately not exercising that path — sanitization runs in the browser DOM. **Spotted-but-not-fixed**: if a future change SSR's the reply rail (currently the rail is client-rendered after the initial-data hydration), confirm `isomorphic-dompurify`'s server adapter is actually invoking JSDOM and not no-oping. File a note under `AGENTS.md` → "Spotted but not fixed" if SSR is ever enabled for `ReplyRow`.
- **Length cap absence (Option D)**: by deliberately *not* adding a server cap, we trust the prompt. If the Agent ignores the "three paragraphs" target on multiple subsequent replies, we revisit. Logging the reply text length as a structured log line could give us telemetry without changing behavior — but that's a separate small change, not in scope here.
- **Prompt change observability**: there is no test for the Agent's reply style. The only signal will be the Dev's perception of the next few replies. If the new replies still look like transcripts, the prompt is too soft and we sharpen it (e.g., add a hard "≤ 400 words" line or move the guidance higher in the system prompt).

## Out of scope

- The composer's plain-textarea behavior. Not a Tiptap upgrade in this change.
- Edit-proposed and edit-done payload rendering. They have their own visual treatment already (`replacement` in a mono block; `text` could still be markdown — flagging as a follow-up if the Dev asks).
- Telemetry / logging on reply length. Worth doing if we need to debug the prompt change; not now.
- Code highlighting (`highlight.js` / Shiki) in fenced code blocks. The Plan editor uses a Confluence-styled language header but no syntax highlighting; replies will match that until the Plan gains highlighting.

## Destructive actions

None. No migration, no contract change, no shared-state mutation, no published-package update, no git push.
