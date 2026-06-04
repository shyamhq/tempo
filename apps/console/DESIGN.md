---
version: alpha
name: Tempo-Mintlify-inspired
description: "White canvas product UI with Mintlify mint accent (#00d4a4), black-pill primary CTAs, Inter body type, and Geist Mono (substituted as JetBrains Mono) for code. Adapted from mintlify.com for the Tempo Console — dense planning surfaces, not marketing heroes."

colors:
  primary: "#0a0a0a"
  on-primary: "#ffffff"
  primary-hover: "#262626"
  brand-green: "#00d4a4"
  brand-green-deep: "#00b88c"
  brand-green-soft: "rgba(0, 212, 164, 0.12)"
  brand-tag: "#3772cf"
  brand-annotate: "#00d4a4"
  brand-warn: "#d97706"
  brand-error: "#dc2626"
  testimonial-orange: "#f97316"
  canvas: "#ffffff"
  canvas-dark: "#0a0a0a"
  surface: "#f6f7f9"
  surface-soft: "#eff1f4"
  surface-code: "#18181b"
  hairline: "#e5e7eb"
  hairline-soft: "#f0f0f0"
  hero-sky-from: "#dbeafe"
  hero-sky-to: "#f7f4ed"
  hero-dark-from: "#0f766e"
  hero-dark-to: "#00d4a4"
  ink: "#0a0a0a"
  charcoal: "#3d3d3d"
  slate: "#64748b"
  steel: "#94a3b8"
  stone: "#a1a1aa"
  muted: "#cbd5e1"
  on-dark: "#ffffff"
  on-dark-muted: "rgba(255, 255, 255, 0.72)"
  semantic-success: "#16a34a"

typography:
  hero-display:
    fontFamily: Inter
    fontSize: 72px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -2px
  display-lg:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.10
    letterSpacing: -1.5px
  heading-1:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: 600
    lineHeight: 1.10
    letterSpacing: -1px
  heading-2:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: -0.5px
  heading-3:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0
  heading-4:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.30
    letterSpacing: 0
  heading-5:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.40
    letterSpacing: 0
  subtitle:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  body-md-medium:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.50
    letterSpacing: 0
  body-sm-medium:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.50
    letterSpacing: 0
  caption:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0
  caption-bold:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.40
    letterSpacing: 0
  micro:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.40
    letterSpacing: 0
  micro-uppercase:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.40
    letterSpacing: 0.5px
  button-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0
  code-md:
    fontFamily: Geist Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  code-sm:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0
  code-inline:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
  xxxl: 40px
  section-sm: 48px
  section: 64px
  section-lg: 96px
  hero: 120px

sizing:
  icon-xs: 13px
  icon-sm: 15px
  icon-md: 18px
  icon-lg: 22px
  sidebar: 300px
  thread-2xl: 1600px

elevation:
  0: none
  1: "0 1px 2px rgba(0, 0, 0, 0.04)"
  card: "0 4px 12px rgba(0, 0, 0, 0.08)"
  mockup: "0 24px 48px -8px rgba(0, 0, 0, 0.12)"
  brand-tint: "0 8px 24px rgba(0, 212, 164, 0.08)"
  compose: "0 1px 2px rgba(10,11,13,0.04), 0 12px 28px -16px rgba(10,11,13,0.16)"
  toast: "0 10px 28px rgba(10, 11, 13, 0.3)"

tracking:
  hero: -2px
  display: -1.5px
  tight-1: -1px
  tight-2: -0.5px
  uppercase: 0.5px
  mono-display: 1.4px
---

## Overview

Mintlify positions itself at the intersection of polished marketing presentation and developer-grade documentation density. The home and startups pages open with cinematic atmospheric heroes — soft sky-gradient backdrops with cloud illustrations on the homepage, dark teal-to-mint gradients with a rocket launch on the startups page — that feel more like a SaaS landing aesthetic than a developer tool. Then the deeper surfaces (pricing comparison, live documentation pages) collapse into dense, high-information layouts where Inter body type carries 14–16px copy across long-form prose, syntax-highlighted code blocks, and 3-column documentation grids.

The brand's signature mint green (`{colors.brand-green}`) appears sparingly but decisively — on the hero "Get started" pill button, the green checkmark icons inside feature lists, the "Featured" pricing tier border, and active state indicators inside docs UI. Black-pill primary buttons dominate the marketing flow; white-on-dark inversions appear on dark hero bands. The signature pairing of Inter (body, headings) with Geist Mono (code blocks, inline references, type signatures) reinforces the developer-tool DNA without requiring a third typeface.

**Tempo Console** uses the *product* half of this language only: white canvas, hairline-bordered cards, black-pill primary actions (`Approve`, `New Thread`), mint for active/focus/connected-adjacent states, and 14–16px Inter for Plans and Comments. Marketing hero bands are out of scope.

**Key Characteristics:**
- White canvas (`{colors.canvas}`) — not cream, not near-black
- Signature mint (`{colors.brand-green}`) reserved for accent CTAs, focus rings, active badges, comment anchors
- Black-pill primary buttons (`{colors.primary}` + `{rounded.full}`)
- Inter for UI prose; JetBrains Mono substitutes for Geist Mono in code blocks
- Cards: `{rounded.lg}` + `{colors.hairline}` border + subtle card shadow
- Pill-shaped buttons and badges (`{rounded.full}`)

## Console token mapping (`globals.css`)

| CSS variable | Mintlify token | Value |
|---|---|---|
| `--color-canvas` | `{colors.canvas}` | `#ffffff` |
| `--color-canvas-dark` | `{colors.canvas-dark}` | `#0a0a0a` |
| `--color-surface-2` | `{colors.surface}` | `#f6f7f9` |
| `--color-surface-3` | `{colors.surface-soft}` | `#eff1f4` |
| `--color-ink` | `{colors.ink}` | `#0a0a0a` |
| `--color-ink-muted` | `{colors.charcoal}` | `#3d3d3d` |
| `--color-ink-subtle` | `{colors.slate}` | `#64748b` |
| `--color-ink-tertiary` | `{colors.steel}` | `#94a3b8` |
| `--color-stone` | `{colors.stone}` | `#a1a1aa` |
| `--color-muted` | `{colors.muted}` | `#cbd5e1` |
| `--color-on-dark` | `{colors.on-dark}` | `#ffffff` |
| `--color-on-dark-muted` | `{colors.on-dark-muted}` | `rgba(255,255,255,0.72)` |
| `--color-hairline` | `{colors.hairline}` | `#e5e7eb` |
| `--color-hairline-soft` | `{colors.hairline-soft}` | `#f0f0f0` |
| `--color-primary` | `{colors.primary}` | `#0a0a0a` |
| `--color-on-primary` | `{colors.on-primary}` | `#ffffff` |
| `--color-accent` | `{colors.brand-green}` | `#00d4a4` |
| `--color-accent-hover` | `{colors.brand-green-deep}` | `#00b88c` |
| `--color-accent-deep` | `{colors.brand-green-deep}` | `#069072` |
| `--color-brand-tag` | `{colors.brand-tag}` | `#3772cf` |
| `--color-brand-warn` | `{colors.brand-warn}` | `#d97706` |
| `--color-testimonial-orange` | `{colors.testimonial-orange}` | `#f97316` |
| `--color-success` | `{colors.semantic-success}` | `#16a34a` |
| `--color-danger` | `{colors.brand-error}` | `#dc2626` |
| `--color-danger-soft` | `{colors.brand-error}` (10% tint) | `#fdecec` |
| `--color-highlight` | pending comment tint | `rgba(0,212,164,0.22)` |

Button variants in code: `primary` = black pill; `accent` = mint pill (use sparingly); `secondary` = outlined pill.

## Colors

### Brand & Accent
- **Mintlify Mint** (`{colors.brand-green}`): Accent CTAs, focus rings, active badges, saved comment underlines.
- **Deep Mint** (`{colors.brand-green-deep}`): Hover on mint surfaces.
- **Black** (`{colors.primary}`): Primary pill CTAs on light backgrounds.

### Surface
- **Canvas White** (`{colors.canvas}`): Page and card background.
- **Surface** (`{colors.surface}`): Composer backgrounds, inputs, subtle panels.
- **Hairline** (`{colors.hairline}`): 1px card and section borders.

### Text
- **Ink** (`{colors.ink}`): Headlines and primary UI text.
- **Charcoal** (`{colors.charcoal}`): Body emphasis, Plan prose.
- **Slate / Steel** (`{colors.slate}`, `{colors.steel}`): Secondary metadata, captions.

### Semantic
- **Success** (`{colors.semantic-success}`): Connected session pill.
- **Error** (`{colors.brand-error}`): Destructive actions and validation.

## Typography

- **Inter** — all UI (fallback stack in `globals.css`).
- **Geist Mono** — code in Plan editor, kbd chips, connect-command blocks. Bundled via the `geist` package; wired through `app/layout.tsx`.

Tailwind v4 exposes every named ramp below as a `text-*` utility. Use the named utility (`text-body-md`, `text-caption`, `text-micro-uppercase`) — never `text-[Npx]` in component code.

| Console use | Token | Size / Weight / Line-height / Letter-spacing |
|---|---|---|
| Page-level headlines (marketing, not built) | `text-heading-1` | 48 / 600 / 1.10 / -1 |
| Section headlines (marketing, not built) | `text-heading-2` | 36 / 600 / 1.20 / -0.5 |
| Dashboard title, big subsection titles | `text-heading-3` | 28 / 600 / 1.25 / 0 |
| Card titles, larger feature headers | `text-heading-4` | 22 / 600 / 1.30 / 0 |
| Sidebar wordmark, FAQ question titles | `text-heading-5` | 18 / 600 / 1.40 / 0 |
| Lead body, hero subtitle | `text-subtitle` | 18 / 400 / 1.50 / 0 |
| Plan body, primary prose | `text-body-md` | 16 / 400 / 1.50 / 0 |
| Body emphasis | `text-body-md-medium` | 16 / 500 / 1.50 / 0 |
| Secondary body, table cells, sidebar nav | `text-body-sm` | 14 / 400 / 1.50 / 0 |
| Active sidebar nav, button labels | `text-body-sm-medium` | 14 / 500 / 1.50 / 0 |
| Helper text, code-block headers, meta | `text-caption` | 13 / 400 / 1.40 / 0 |
| Badge labels | `text-caption-bold` | 13 / 600 / 1.40 / 0 |
| Footer microcopy, label chips, badges | `text-micro` | 12 / 500 / 1.40 / 0 |
| Uppercase section labels, "REQUIRED" tags | `text-micro-uppercase` | 11 / 600 / 1.40 / +0.5 |
| Pill button labels | `text-button-md` | 14 / 500 / 1.30 / 0 |
| Code block content (Geist Mono) | `text-code-md` | 14 / 400 / 1.50 / 0 |
| Smaller code, type signatures (Geist Mono) | `text-code-sm` | 13 / 400 / 1.40 / 0 |
| Inline code references (Geist Mono) | `text-code-inline` | 13 / 500 / 1.30 / 0 |

### Snap rules (for legacy `text-[Npx]` sweeps)

| Found in code | Snaps to | Visible shift |
|---|---|---|
| 9, 10, 10.5, 11.5, 12, 12.5 px | `text-micro` (12) | ≤3 px (Dev-approved) |
| 11 px in uppercase / tracking-wide context | `text-micro-uppercase` (11) | 0 |
| 11 px elsewhere | `text-micro` (12) | +1 |
| 13, 13.5 px | `text-caption` (13) or `text-body-sm` (14) | ≤0.5 |
| 14, 15, 16 px | `text-body-sm` or `text-body-md` per site | ≤1 |
| 17 px | `text-heading-5` (18) | +1 |

## Components (Console)

### Built in this codebase

#### Buttons
- **`button-primary`**: `bg-primary`, `text-on-primary`, `rounded-full`, h-9, px-5. Used for Approve, New Thread, form submit.
- **`button-accent`**: `bg-accent`, `text-on-accent`, mint pill — optional emphasis (not default).
- **`button-secondary`**: transparent, `border-hairline`, `rounded-full`.
- **`button-ghost`**: tertiary header actions (Reopen).

#### Cards
- **`card-base`**: white background, `border-hairline`, `rounded-lg`, light `shadow-card`.
- **Compose card** (New-Thread surface): `rounded-xl`, `shadow-compose`. The hero headline uses a fluid `clamp(28px, 4vw, 40px)` font-size — exempt from the lint rule via the `clamp(`/`calc(`/`var(` carve-out.

#### Badges
- Pill shape (`rounded-full`). `success` = green session; `accent` = mint tint for status chips.

#### Icons
- Use `size-icon-xs/sm/md/lg` (13 / 15 / 18 / 22 px) for recurring icon dimensions. One-offs (e.g. `h-3.5 w-3.5` for hover-arrow chevrons) stay inline.

### Documented but not built (lands when the marketing routes exist)

The fuller Mintlify-derived spec also describes hero bands, pricing cards, the testimonial card, FAQ accordion, footer region, promo banner, customer-logo wall, and the hero product mockup. None of these are implemented in the Console code today — the Console is product UI only. They are documented above (in the frontmatter `elevation`, `tracking`, `spacing` ladders, plus the marketing-only token names: `hero-display`, `display-lg`, `heading-1`, `heading-2`, `hero-sky-*`, `hero-dark-*`, `testimonial-orange`, `shadow-mockup`, `shadow-brand-tint`, `spacing.section-lg`, `spacing.hero`) so the language stays a single source of truth — but no surfaces in this codebase reference them yet.

## Do's and Don'ts

### Do
- Use `{colors.brand-green}` sparingly — focus, active nav, accent badges, comment marks.
- Use black pills for primary actions on white canvas.
- Use `{rounded.full}` on buttons and badges.
- Keep Plan/comment prose at 16px with 1.5 line-height.

### Don't
- Don't paint large surfaces mint or black — white canvas carries the UI.
- Don't use charcoal (`#1c1c1c`) as the page background (that was the old Lovable swap).
- Don't use raw Tailwind palette classes (`bg-gray-100`, `text-blue-500`) in components — semantic tokens only.
- Don't use `{rounded.md}` on primary CTAs — pills only.

## Standing rules (enforced in review)

1. **Semantic tokens only** in `apps/console/{app,components,hooks,lib}` — no `gray-*`, `blue-*`, `black/*` shorthands.
2. **Primary actions are black pills** (`variant="primary"`), not mint.
3. **Mint is accent** (`--color-accent`, `variant="accent"`, badge `tone="accent"`) — never the default page chrome.
4. **Named text/radius/icon utilities only** — no arbitrary `text-` / `rounded-` size literals, no raw hex or rgba inside `bg-` / `text-` / `border-` arbitrary syntax. Carve-outs: arbitrary `text-` literals containing `clamp(`, `calc(`, or `var(` for fluid responsive sizes; arbitrary `text-` rem values (e.g. `1.25rem`) for `@tailwindcss/typography` prose-class proportional overrides; the Tailwind opacity syntax `bg-accent/N` is fine because the base colour is a token. Arbitrary `w-`, `h-`, `px-`, `gap-`, `shadow-`, `leading-`, `tracking-` size literals are **not** caught by the guard — these are smaller categories with a wider legitimate range of values; tokenise when a value recurs 2+ times. Enforced by `scripts/check-design-tokens.sh`, wired into `bun run lint`.

## Known gaps

- Hero atmospheric gradients (`hero-sky-*`, `hero-dark-*`) are documented but unused in Console routes.
- Full marketing component catalog (pricing tiers, testimonial orange card) is reference-only.
- Dark mode tokens are not defined; Console ships light only for MVP.
