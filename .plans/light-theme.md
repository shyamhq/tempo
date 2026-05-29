# Plan — Switch Console to a Lovable-inspired light theme

## Problem statement

The Console ships a dark Linear-derived palette (cool charcoal page, lavender accent, white text). The Dev wants a light theme inspired by Lovable's reference spec: warm cream page, near-black ink, opacity-derived grays, charcoal-as-action (no chromatic accent), and `#eceae4` warm borders. Additional constraint from the Dev's last message: **use design tokens everywhere instead of hardcoding values** — anywhere a component currently reaches for a raw Tailwind palette color (`red-400`, `red-500`, `amber-500`, `black/60`) must move to a semantic token.

The current `globals.css` already centralizes the palette in a Tailwind v4 `@theme` block with semantic names (`canvas`, `surface-1..4`, `ink`, `ink-muted`, `ink-subtle`, `ink-tertiary`, `hairline`, `hairline-strong`, `accent`, `accent-hover`, `accent-focus`, `success`, `on-accent`). 25 files reference those tokens — they don't need to change. Only the *values* change.

## Smallest concrete change

### 1. Swap token values in `apps/console/app/globals.css`

Same token names, new light values per the Lovable spec.

| Token | Before (dark) | After (light) |
|---|---|---|
| `--color-canvas` | `#010102` | `#f7f4ed` (cream page) |
| `--color-surface-1` | `#0f1011` | `#f7f4ed` (cards match page per spec §6) |
| `--color-surface-2` | `#141516` | `rgba(28,28,28,0.03)` (subtle overlay) |
| `--color-surface-3` | `#18191a` | `rgba(28,28,28,0.04)` (hover tint) |
| `--color-surface-4` | `#191a1b` | `rgba(28,28,28,0.06)` (active tint) |
| `--color-ink` | `#f7f8f8` | `#1c1c1c` (charcoal) |
| `--color-ink-muted` | `#d0d6e0` | `rgba(28,28,28,0.82)` (body) |
| `--color-ink-subtle` | `#8a8f98` | `#5f5f5d` (muted gray) |
| `--color-ink-tertiary` | `#62666d` | `rgba(28,28,28,0.4)` (faint text / icons) |
| `--color-hairline` | `#23252a` | `#eceae4` (warm divider) |
| `--color-hairline-strong` | `#34343a` | `rgba(28,28,28,0.4)` (interactive border) |
| `--color-hairline-tertiary` | `#3e3e44` | `rgba(28,28,28,0.6)` |
| `--color-accent` | `#5e6ad2` (lavender) | `#1c1c1c` (charcoal — Lovable's CTA is just charcoal; "accent" stays the semantic name for "primary action color") |
| `--color-accent-hover` | `#828fff` | `rgba(28,28,28,0.83)` |
| `--color-accent-focus` | `#5e69d1` | `#1c1c1c` |
| `--color-on-accent` | `#ffffff` | `#fcfbf8` (off-white per spec) |
| `--color-success` | `#27a644` | `#3f8a4f` (desaturated to live in the cream world; still readable for the connected-pill dot) |

### 2. Add three new semantic tokens (replaces the only raw-Tailwind references in the codebase)

| New token | Value | Replaces |
|---|---|---|
| `--color-danger` | `#c4453d` (warm rust on cream) | `text-red-500`, `text-red-400` in delete-button + new-thread-dialog |
| `--color-highlight` | `#d4a72c` | `border-amber-500`, `bg-amber-500/25` for Comment marks |
| `--color-overlay` | `rgba(28,28,28,0.5)` | `bg-black/60` in dialog overlay |

### 3. Add two shadow tokens for Lovable's signature treatments

Tailwind v4 lets us register shadows in `@theme` so they're usable as `shadow-inset-button` / `shadow-focus-soft` utilities:

```css
--shadow-inset-button:
  rgba(255,255,255,0.2) 0 0.5px 0 0 inset,
  rgba(0,0,0,0.2) 0 0 0 0.5px inset,
  rgba(0,0,0,0.05) 0 1px 2px 0;
--shadow-focus-soft: rgba(0,0,0,0.1) 0 4px 12px;
```

Apply `shadow-inset-button` to `Button` primary variant. Apply `shadow-focus-soft` to the focus state on Button and on inputs (replacing the current accent ring).

### 4. Font stack — Inter substitute, keep all other typography rules

Camera Plain Variable is a proprietary Lovable typeface and not redistributable. **Substitute Inter** (already in the stack) with the same weight/letter-spacing rules the Lovable spec describes (weight 400 body / 600 headings; negative letter-spacing at display sizes). Inter has the humanist warmth and a continuous variable axis that matches the spec's intent. `--font-display` and `--font-sans` both point to `'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif`.

Document in DESIGN.md as an explicit substitution; swapping to a licensed humanist face is a one-line change later.

### 5. Update `::selection` in `globals.css`

`background: color-mix(in oklab, var(--color-accent) 35%, transparent)` — same expression, new accent value (charcoal at 35%). Reads correctly on cream.

### 6. Replace component-level hardcoded color references with the new tokens

Seven lines across six files (judge spotted a missing one — `clarification-modal.tsx` — added here):

| File | Change |
|---|---|
| `apps/console/components/ui/dialog.tsx:23` | `bg-black/60` → `bg-overlay` |
| `apps/console/components/ui/button.tsx` | Apply `shadow-inset-button` to primary variant; replace ring with `shadow-focus-soft` on focus |
| `apps/console/components/dashboard/delete-thread-button.tsx:37` | `hover:text-red-500` → `hover:text-danger` |
| `apps/console/components/dashboard/new-thread-dialog.tsx:139` | `text-red-400` → `text-danger` |
| `apps/console/components/thread/clarification-modal.tsx:70` | `text-red-400` → `text-danger` |
| `apps/console/components/thread/comment-cards.tsx:43` | `border-amber-500/50` → `border-highlight/60` |
| `apps/console/components/thread/editor/comment-mark.ts:37` | `bg-amber-500/25 border-b border-amber-500` → `bg-highlight/30 border-b border-highlight` |

After this, `grep -rE '\b(red|amber|emerald|blue|yellow|black|white)-[0-9]+\b' apps/console/{app,components,hooks,lib} --include='*.tsx' --include='*.ts' --include='*.css'` should return zero matches. That grep becomes the standing check that no future component drifts back to raw palette.

### 7. Update `apps/console/DESIGN.md` (scoped — not a full redesign)

`apps/console/DESIGN.md` is the verbatim `getdesign` output for Linear and serves as the visual-language doc per CLAUDE.md's priority table. The judge correctly flagged that "full rewrite" is too loose — it invites scope creep into layout/component redesign that is *not* in this plan.

**Scope guard.** Preserve the existing document structure: keep all section headers, the typography size table, the radius/spacing scales, the responsive section, the components section, the depth/elevation section, and any front-matter format. Update only:

- Color values in the palette tables (swap dark hex → Lovable light values per §1).
- Color descriptions where they say "dark canvas" / "lavender accent" / similar dark-system phrasings.
- Font-family entries (point to Inter; document Camera Plain as the inspiration but not shipped).
- Add a single new short section "Standing rules" at the end with: (a) no raw Tailwind palette classes in components, (b) inset-button shadow on primary CTAs, (c) opacity-derived grays from `--color-ink`.

Do **not** change: layout principles, grid sections, the radius scale (4/6/8/12/16/9999), the spacing scale, the responsive breakpoints, the component-shape definitions (button paddings, card paddings, input geometries), or the elevation system beyond adding the inset-button shadow rule. If a section talks about "Linear" by name, leave the structural content and just re-attribute the inspiration to "Lovable-inspired light system."

## Files touched

- `apps/console/app/globals.css` — values + new tokens + shadow tokens + selection.
- `apps/console/DESIGN.md` — palette/font sections updated, structure preserved (see §7 scope guard).
- `apps/console/components/ui/dialog.tsx` — 1 line.
- `apps/console/components/ui/button.tsx` — primary variant adds shadow utilities, focus shadow replaces ring.
- `apps/console/components/dashboard/delete-thread-button.tsx` — 1 line.
- `apps/console/components/dashboard/new-thread-dialog.tsx` — 1 line.
- `apps/console/components/thread/clarification-modal.tsx` — 1 line.
- `apps/console/components/thread/comment-cards.tsx` — 1 line.
- `apps/console/components/thread/editor/comment-mark.ts` — 1 line.

No new modules. No new files (DESIGN.md is a rewrite of an existing file). No contract changes. No server changes. No DB migration.

## Layer placement (rule 19)

| Change | Layer | Justification |
|---|---|---|
| `globals.css` token values + new tokens | Theme | Tailwind v4 `@theme` is the canonical place for the palette. Same layer the existing tokens already live in. |
| Component class-name edits | UI | Pure presentational swaps. No business logic touched. |
| `DESIGN.md` rewrite | Docs | Visual-language doc; lives where it already lives. |

No DB layer, no server layer, no contracts layer affected.

## Deletion test

No new modules introduced. The new tokens (`--color-danger`, `--color-highlight`, `--color-overlay`, `--shadow-inset-button`, `--shadow-focus-soft`) are *semantic names for things components were already using as one-off literals*. If we deleted them in 6 months, components would either go back to hardcoding raw palette values (the bug the Dev just asked us to prevent) or grow inline `style={{}}` colors. So the tokens exist precisely to make "no raw palette in components" enforceable. Each has more than one current consumer once the swap lands.

## Alternatives considered

### A1. Token values vs. add a `data-theme="light"` attribute and ship both

- **Chosen: swap values in place.** The Dev asked for "the" light theme, not a toggleable dual mode. Adding a second theme doubles the surface to verify and introduces a runtime-theme contract that nothing else in the product needs. Single source of truth, less code.
- Alternative: CSS-variable scopes under `[data-theme]` selectors. Rejected on scope creep — can be added later if multi-theme becomes a real requirement; ripping it out is harder than adding it.

### A2. Map Linear-lavender `accent` to a chromatic Lovable accent vs. to charcoal

- **Chosen: map `accent` → charcoal (`#1c1c1c`).** The Lovable spec explicitly says the system has no chromatic accent — primary action is just charcoal-on-cream. Keeping the *name* `accent` means component code doesn't have to change; only the *meaning* shifts from "the brand color" to "the primary action color," which is the same role in both systems.
- Alternative: pick a warm chromatic accent (orange, terracotta) to give the product a distinct color. Rejected — adds a design decision that's out of scope for "switch to light." Easy to introduce later by adding `--color-brand` next to `--color-accent`.

### A3. Camera Plain Variable vs. Inter vs. Geist/Plus Jakarta

- **Chosen: Inter.** Already in the stack; variable axis; widely supported; humanist enough that the letter-spacing rules from the spec read correctly. Zero new dependencies, zero font-licensing concerns.
- Alternative: Geist (newer humanist sans by Vercel). Rejected for now — would add a font dep for marginal aesthetic gain. Re-evaluate when/if we have brand-design bandwidth.
- Alternative: License Camera Plain. Rejected — not part of this scope, and Lovable's font is proprietary to them.

### A4. Shadow tokens vs. one-off `style` props on the Button

- **Chosen: register shadow utilities in `@theme`.** Tailwind v4 supports `--shadow-<name>` → `shadow-<name>` utility. Once registered, "primary buttons get the inset shadow" is `className="shadow-inset-button"` — visible in the markup, no inline styles, no special-case wrapper. Same discipline as the color tokens.
- Alternative: inline `style={{ boxShadow: '...' }}` on the Button. Rejected — exactly the kind of "raw value in a component" the Dev just told us to stop doing.

## Uncertainties

- **U1.** The dialog overlay currently uses `bg-black/60` which composites against whatever is behind. Switching to `bg-overlay` = `rgba(28,28,28,0.5)` is the right semantic, but the perceived darkness will shift slightly. I'll eyeball it on first paint and bump opacity if it reads weak against the cream surfaces — likely fine at 0.5.
- **U2.** `--color-success` is desaturated to `#3f8a4f` so the connected-pill green doesn't scream against cream. If it reads too muted (people can't tell it's green), bump saturation. The current uses are `bg-success/15`, `border-success/30`, `text-success`, `bg-success` (a 1.5x1.5 dot) — all already alpha-blended so the muted base should be fine.
- **U3 — RESOLVED.** Tailwind v4 docs confirmed via Context7: the `--shadow-*` theme namespace produces `shadow-*` utility classes (see "Theme variable namespaces" in `theme.mdx`). So `--shadow-inset-button` and `--shadow-focus-soft` registered in the `@theme` block become `shadow-inset-button` and `shadow-focus-soft` utilities automatically. No fallback needed. (If a fallback were ever needed, the correct v4 form is `@utility shadow-inset-button { box-shadow: ...; }` — not a bare global class rule. Noted for any future agent who hits a similar question.)
- **U4.** Inter's `font-feature-settings` — the current Linear-style display uses `'ss01' on, 'cv11' on` historically. For Inter the equivalent ligature/alt rules are different; defaulting to no extra features is fine and matches the Lovable spec's minimalism.
- **U5.** The Comment mark color (`--color-highlight`) currently shows as bright amber against dark surface-2. On cream it needs to be visibly different from the body but not eye-searing. `#d4a72c` at `bg-highlight/30` is a mustard underline — readable but quiet. Adjust if the Dev finds it too loud on first look.

## Destructive actions

None. No data migration, no schema change, no force-push, no hook-skip, no `rm -rf`. Pure visual swap; the build still compiles; all existing components continue to render. Dev acknowledgment of destructive actions: **N/A**.

## Out of scope

- Adding a dark/light mode toggle (single theme only per the request).
- Licensing or self-hosting Camera Plain Variable.
- Visual redesign beyond palette + font + signature shadows (no layout changes, no new components).
- Adding a chromatic brand accent on top of the charcoal-only Lovable base.
- Tests (T12 — no tests in MVP).

## Pickup notes

After APPROVED:
1. Edit `apps/console/app/globals.css` — token values, three new color tokens, two shadow tokens, `::selection` left as-is (the expression auto-tracks new accent value).
2. Edit the seven component lines listed in §6 (note the added `clarification-modal.tsx:70`).
3. Update `Button` variants in `apps/console/components/ui/button.tsx` to use `shadow-inset-button` on primary and `focus-visible:shadow-focus-soft` on all variants (replaces the existing accent-ring focus).
4. Update `apps/console/DESIGN.md` per the §7 scope guard — palette/font sections only; preserve structure and the rest of the doc.
5. Run the standing grep: `grep -rE '\b(red|amber|emerald|blue|yellow|black|white)-[0-9]+\b' apps/console/{app,components,hooks,lib} --include='*.tsx' --include='*.ts' --include='*.css'` → expect zero matches. The new "Standing rules" subsection of DESIGN.md records this as policy for future agents.
6. `bun run --filter @tempo/console dev`, eyeball each route (dashboard, Thread, modal, empty plan, handoff banner) for any contrast/legibility regressions.
7. Run `code-simplifier` + `everything-claude-code:code-reviewer` per CLAUDE.md.
8. Commit as `[2.x] theme: light (Lovable-inspired) — semantic tokens everywhere`.
