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
  button-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px

spacing:
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
  section: 64px
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
| `--color-surface-2` | `{colors.surface}` | `#f6f7f9` |
| `--color-surface-3` | `{colors.surface-soft}` | `#eff1f4` |
| `--color-ink` | `{colors.ink}` | `#0a0a0a` |
| `--color-ink-muted` | `{colors.charcoal}` | `#3d3d3d` |
| `--color-ink-subtle` | `{colors.slate}` | `#64748b` |
| `--color-ink-tertiary` | `{colors.steel}` | `#94a3b8` |
| `--color-hairline` | `{colors.hairline}` | `#e5e7eb` |
| `--color-primary` | `{colors.primary}` | `#0a0a0a` |
| `--color-on-primary` | `{colors.on-primary}` | `#ffffff` |
| `--color-accent` | `{colors.brand-green}` | `#00d4a4` |
| `--color-accent-hover` | `{colors.brand-green-deep}` | `#00b88c` |
| `--color-success` | `{colors.semantic-success}` | `#16a34a` |
| `--color-danger` | `{colors.brand-error}` | `#dc2626` |
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
- **JetBrains Mono** — code in Plan editor and connect-command blocks (Geist Mono substitute).

| Console use | Token | Size |
|---|---|---|
| Dashboard title | `{typography.heading-3}` | 28px / 600 |
| Thread header title | `{typography.body-sm-medium}` | 14px / 500 |
| Plan body | `{typography.body-md}` | 16px / 400, line-height 1.5 |
| Comments rail label | `{typography.caption}` | 13px |
| Buttons | `{typography.button-md}` | 14px / 500 |

## Components (Console)

### Buttons
- **`button-primary`**: `bg-primary`, `text-on-primary`, `rounded-full`, h-9, px-5. Used for Approve, New Thread, form submit.
- **`button-accent`**: `bg-accent`, `text-on-accent`, mint pill — optional emphasis (not default).
- **`button-secondary`**: transparent, `border-hairline`, `rounded-full`.
- **`button-ghost`**: tertiary header actions (Reopen).

### Cards
- **`card-base`**: white background, `border-hairline`, `rounded-lg`, light `shadow-card`.

### Badges
- Pill shape (`rounded-full`). `success` = green session; `accent` = mint tint for status chips.

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
4. **Geist Mono** is not bundled; JetBrains Mono is the monospace substitute until a font package is added.

## Known gaps

- Hero atmospheric gradients (`hero-sky-*`, `hero-dark-*`) are documented but unused in Console routes.
- Full marketing component catalog (pricing tiers, testimonial orange card) is reference-only.
- Dark mode tokens are not defined; Console ships light only for MVP.
