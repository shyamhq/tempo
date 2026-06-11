---
name: html-block
description: Author HTML blocks in Plan blocks. Use when a layout sketch, interactive mockup, or design-system surface is the clearest way to communicate UI intent. Encodes the Console's iframe-sandbox constraints, the Tailwind-via-CDN convention, and the rules that keep HTML blocks legible and accessible.
---

# HTML blocks in Tempo Plans

The Console renders HTML blocks inside a **sandboxed iframe** (`sandbox="allow-scripts"`, no `allow-same-origin`). The HTML is rendered verbatim — the sandbox is the trust boundary. The iframe auto-grows to its content height up to a cap. There is no shared origin with the Console, so localStorage, cookies, and parent-window access do not work.

## When to reach for an HTML block

HTML blocks are the heaviest block type in a Plan — they take longer to write, longer to review, and longer to render. Use them when prose plus a code block cannot carry the same meaning. Concretely:

- **Layout sketch** — show what a screen / panel / form will look like, with realistic spacing and hierarchy. Faster than describing "a two-column layout with a sticky header and a 320px sidebar".
- **Interactive prototype** — a small mockup where clicking buttons or filling inputs demonstrates the intended interaction. Use sparingly; a static sketch is usually enough.
- **Design-system surface** — render the actual components (buttons, badges, callouts) in the intended palette so the Dev can react to the visual language, not a description of it.
- **Diff or before/after** — show two versions side by side when the change is visual.

Skip HTML blocks when:

- A flowchart or sequence diagram would carry the structure (it's lighter to read).
- The point is a copy change, a state-machine, or a data flow.
- You haven't reached agreement on what to build yet — HTML blocks anchor on a specific visual, and over-eager mockups foreclose discussion.

For first drafts, you may include one HTML block if the Plan is unmistakably UI work. Otherwise, offer first in a Discussion message: *"I can sketch the empty-state UI as an html-block — useful, or skip?"*

## The Tempo wrapper

Wrap every HTML block exactly like this:

```html
<pre><code class="language-html-block">
<!doctype html>
<html lang="en">
  <head>…</head>
  <body>…</body>
</html>
</code></pre>
```

Without `class="language-html-block"` (or `data-language="html-block"`) the block renders as a plain code fence. The class is load-bearing.

Always include `<!doctype html>` and `<html lang="en">`. Always include `<meta charset="utf-8">` and `<meta name="viewport" content="width=device-width,initial-scale=1">` in the `<head>`. Without these the iframe renders in quirks mode and font sizing is unpredictable.

## Tailwind via CDN — the default styling path

Use Tailwind for every HTML block. The iframe is sandboxed; the CDN script loads at iframe init and JIT-compiles classes from the markup. No build step, no Tempo config.

```html
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Optional: configure Tailwind here if you need extra colors, fonts, etc. */
    /* tailwind.config = { theme: { extend: { …  } } }  — only via JS, below. */
  </style>
</head>
```

Tailwind on CDN is the JIT compiler. Every class you reference in your markup must exist in Tailwind's default class list, or you must declare it via `tailwind.config` in a `<script>` block before any markup. Arbitrary values (`bg-[#0EA5E9]`, `w-[320px]`) work without config.

**Inter font** is the Console's default and the right choice for parity:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  html { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
</style>
```

## Sandbox-imposed constraints

The iframe has `allow-scripts` but no `allow-same-origin`. This means:

- **Yes:** inline `<script>`, fetch from public CDNs, canvas, SVG, web fonts, CSS animations, click handlers.
- **No:** `localStorage`, `sessionStorage`, cookies, calls back to the Console origin, calls to authenticated APIs.
- **No:** opening links into the parent window. `target="_blank"` works for new tabs; same-window navigation inside the iframe is fine.
- **No:** copying generated content out to the Console — there is no shared origin.

If you find yourself wanting to call an authenticated API from inside the iframe, the right answer is: don't. Mock the data inline in JS, or stage it as JSON in a `<script>` tag.

## Authoring rules

1. **One screen per HTML block.** If you need three screens (empty / populated / error), make three blocks. Side-by-side variants inside one block become unreadable quickly.
2. **Constrain the width.** The iframe is full-Console-width by default; mock UIs at a realistic width (`max-w-md`, `max-w-2xl`, `max-w-4xl`) inside a centered wrapper. Otherwise the layout reads as oddly wide.
3. **Use semantic HTML.** `<button>`, `<label>`, `<input>`, `<nav>`, `<main>`, `<section>`. Even in a mockup. Reviews catch a11y intent earlier when the structure is real.
4. **No real data.** Use placeholder strings (`"Project X"`, `"alice@example.com"`) — never real user data, real customer names, or real-looking secrets. Plans get pasted into Claude Code sessions; staging anything that looks live is a trap.
5. **No external images you don't control.** Use inline SVG, CSS shapes, or unsplash links only as last resort; they break the moment the URL changes.
6. **Respect dark mode.** The Console is light by default but Devs run dark mode. Use Tailwind's `dark:` variants and check that contrast holds in both. See the `color-and-contrast` skill.

## Skeleton — the starting point

Copy this skeleton; edit inside `<main>`. Do not skip the head section.

```html
<pre><code class="language-html-block">
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      html { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    </style>
  </head>
  <body class="bg-slate-50 text-slate-900 antialiased">
    <main class="mx-auto max-w-2xl p-8">
      <!-- Your sketch goes here. Use semantic HTML and Tailwind utilities. -->
      <h1 class="text-2xl font-semibold tracking-tight">Empty workspace</h1>
      <p class="mt-2 text-sm text-slate-600">
        Invite a teammate to start collaborating on Plans.
      </p>
      <button class="mt-6 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
        Invite teammate
      </button>
    </main>
  </body>
</html>
</code></pre>
```

## Before you write

- [ ] Is prose + a small diagram enough? If yes, skip the HTML block.
- [ ] Wrapped in `<pre><code class="language-html-block">…</code></pre>`?
- [ ] Doctype, meta charset, meta viewport, Tailwind CDN script all present?
- [ ] Width constrained to a realistic mockup width (`max-w-md`/`max-w-2xl`/`max-w-4xl`)?
- [ ] Semantic HTML, no real data ?
- [ ] Contrast holds in both light and dark surfaces? (See `color-and-contrast`.)

HTML blocks are powerful because they let the Dev react to a real visual.
