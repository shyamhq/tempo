---
name: color-and-contrast
description: Pick foreground/background color pairs that are legible. Use whenever rendering text on a colored surface in an HTML block, styling a Mermaid diagram, or choosing a callout palette. Prevents the recurring failure mode where the agent picks a low-contrast pair that looks fine in the editor but is unreadable in the rendered output.
---

# Color and contrast

The Console's rendered surfaces (HTML blocks, themed Mermaid diagrams, custom callouts) frequently end up with text the Dev can barely read. The cause is almost always the same: the agent picks a foreground and a background that look "nice together" without checking they actually contrast. This skill keeps you out of that trap.

The rule that matters: **every text-on-surface pair you put in a Plan must hit WCAG 2.1 contrast**.

- **AA Normal text:** contrast ratio ≥ **4.5 : 1**
- **AA Large text** (≥ 18.66px regular, or ≥ 14px bold): contrast ratio ≥ **3 : 1**
- **AAA Normal text:** ≥ **7 : 1** (aim for this when you can; the Plan will be read on glare-y laptop screens)
- **Non-text UI** (icons, borders that carry meaning): ≥ **3 : 1**

If you don't know the ratio of a pair you're about to use, the safest move is to pick from the audited palette below.

## The failure modes that recur

1. **Yellow on white / light gray on white.** Contrast often <2:1. Looks fine on a vibrant display, unreadable on a dim one. Never pair `text-yellow-300/400/500` with `bg-white` or `bg-slate-50`. If the text *must* be yellow, put it on `bg-slate-900` or darker.
2. **Dark gray on dark surface.** `text-slate-700` on `bg-slate-900` is ~3.5:1 — it passes for large text only. For body text use `text-slate-300` or lighter on `bg-slate-900`.
3. **Mid-gray on white.** `text-slate-400` on `bg-white` is ~3:1 — fails AA for body. Use `text-slate-600` (4.83:1) or darker for normal text.
4. **Color-on-color.** Putting `text-blue-500` on `bg-blue-100` looks branded but reads as ~2.5:1. Bump one end (text to `blue-700` or background to `blue-50`).
5. **Smart-quote em-dashes from a docs paste.** Not contrast, but visually similar fail: U+2013/U+2014 vs hyphen-minus render with different glyph widths and break monospace alignment. Stay with `-` unless you mean an em-dash and own the alignment.
6. **Accent color as body text.** Tempo's accent (`#00D4A4`) is fine for emphasis but fails AA against most backgrounds for body. Use it on borders and pills, not for paragraphs.

## Tested foreground / background pairs

Use these defaults instead of inventing pairs from scratch. All ratios computed against the listed background.

### Light surface

| Surface | Recommended text | Ratio | Use for |
|---|---|---|---|
| `bg-white` | `text-slate-900` (#0F172A) | 19.3 : 1 | Body text, headings. |
| `bg-white` | `text-slate-700` (#334155) | 10.8 : 1 | Secondary text. |
| `bg-white` | `text-slate-600` (#475569) | 7.6 : 1 | Tertiary text — still AA. |
| `bg-slate-50` (#F8FAFC) | `text-slate-900` | 18.3 : 1 | Body. |
| `bg-slate-100` (#F1F5F9) | `text-slate-900` | 16.8 : 1 | Surface-2, body. |

### Dark surface

| Surface | Recommended text | Ratio | Use for |
|---|---|---|---|
| `bg-slate-900` (#0F172A) | `text-white` | 19.3 : 1 | Body, headings. |
| `bg-slate-900` | `text-slate-100` | 17.1 : 1 | Body. |
| `bg-slate-900` | `text-slate-300` (#CBD5E1) | 11.0 : 1 | Secondary text. |
| `bg-slate-900` | `text-slate-400` (#94A3B8) | 6.5 : 1 | Tertiary — AA only. |
| `bg-slate-800` (#1E293B) | `text-slate-100` | 14.2 : 1 | Body. |

### Status / signal palettes (light surface)

| Variant | Surface | Border | Text |
|---|---|---|---|
| Info | `bg-blue-50` | `border-blue-200` | `text-blue-900` (10.5:1) |
| Success | `bg-emerald-50` | `border-emerald-200` | `text-emerald-900` (10.1:1) |
| Warning | `bg-amber-50` | `border-amber-200` | `text-amber-900` (9.6:1) |
| Error | `bg-rose-50` | `border-rose-200` | `text-rose-900` (10.4:1) |

### Status / signal palettes (dark surface)

| Variant | Surface | Border | Text |
|---|---|---|---|
| Info | `bg-blue-950` | `border-blue-800` | `text-blue-200` (10.8:1) |
| Success | `bg-emerald-950` | `border-emerald-800` | `text-emerald-200` (11.1:1) |
| Warning | `bg-amber-950` | `border-amber-800` | `text-amber-200` (10.4:1) |
| Error | `bg-rose-950` | `border-rose-800` | `text-rose-200` (10.7:1) |

### Buttons (always pass AA)

| Variant | Background | Text | Ratio |
|---|---|---|---|
| Primary | `bg-slate-900` | `text-white` | 19.3 : 1 |
| Secondary | `bg-white` + `border-slate-300` | `text-slate-900` | 19.3 : 1 |
| Destructive | `bg-rose-600` | `text-white` | 5.1 : 1 |
| Ghost | (transparent) | `text-slate-700` on `bg-white` | 10.8 : 1 |

## When you must pick a fresh pair

If the design calls for a color that isn't in the table above:

1. **Pick the surface first**, then choose text from a darker step on the same scale (light surface) or a lighter step (dark surface).
2. **Skip at least 4 steps on Tailwind's scale** between background and text — e.g. `bg-blue-50` (step 50) → `text-blue-700` or darker. `bg-blue-100` → `text-blue-800` or darker. This is a rule-of-thumb that almost always produces ≥7:1 against `bg-blue-50/100`.
3. **Verify** with an online checker (search "WCAG contrast checker") or by checking the hex values against [the WebAIM API rule](https://webaim.org/articles/contrast/) — `(L1 + 0.05) / (L2 + 0.05)` where L1 is lighter relative luminance.
4. If it's borderline, **bump the text one step darker** rather than trying to argue the threshold. The reader is on a worse screen than yours.

## Dark mode

Every HTML block must render legibly under `prefers-color-scheme: dark`. Two acceptable approaches:

- **Stay light-only.** Add `class="bg-white text-slate-900"` to `<body>`. The mockup looks the same on dark and light Console. Acceptable when the design is unambiguously a light-mode screen.
- **Adapt with Tailwind's `dark:` prefix.** `<body class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">`. Use the audited pairs above for both halves.

Don't ship a mockup that says "looks fine in light mode, dark mode is broken." It signals to the Dev that the design isn't finished.

## Mermaid theming

Mermaid's default theme is fine for most diagrams. If you customise (`%%{init: { 'theme': 'base', 'themeVariables': { … } } }%%`), use audited pairs only:

- **Node text** must hit ≥ 4.5:1 against `nodeFill`.
- **Edge labels** must hit ≥ 4.5:1 against the diagram background (default white or theme `background`).
- **Don't** set `primaryTextColor` to a mid-gray on a white background — it's unreadable at the rendered size.

Most of the time: leave Mermaid's default theme alone. Custom themes are a frequent source of contrast failures.

## Before you ship a colored surface

- [ ] Picked from the audited pairs above, or verified ≥ 4.5:1 against an actual contrast checker?
- [ ] Body text ≥ 4.5:1 (AA Normal)? Headings ≥ 3:1 (AA Large)?
- [ ] Tested in both light and dark mode (or explicitly light-only)?
- [ ] No yellow / mid-gray / accent-color body text on light surfaces?
- [ ] No `text-slate-700`-or-darker body text on dark surfaces?
- [ ] Status palettes use the audited combinations, not improvised ones?

When in doubt: **white background, slate-900 text**. It's never wrong. It's never the most exciting choice, either — but the Plan reads, and that's the only metric that matters.
