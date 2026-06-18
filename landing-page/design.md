# Tempo — Landing Page Design System ("Nocturne")

> A dark, cinematic system derived from the hero video: a midnight-navy night sky, glowing laptops and marigold flowers, books, quiet focus. The palette reads the page the way the video reads the frame — deep cool canvas, warm points of light. Used by the `index-c.html` cinematic variant. Format follows the getdesign.md convention (tokens → type → surfaces → motion → components).

## Voice

Cinematic, calm, premium. The page is the night sky; UI is the glow. Restraint over decoration — one warm accent at a time, lots of dark negative space, type carries the personality. Awwwards register: the video and one orchestrated motion per section do the talking.

## Color tokens

Canvas and ink are a near-inverse of the warm "paper" system, tuned for the navy video rather than pure black.

| Token | Hex / value | Role |
|---|---|---|
| `--paper` | `#081826` | Base canvas — midnight navy (matches the video sky) |
| `--paper-2` | `#0C2233` | Raised band / alternating section |
| `--card` | `#102A3C` | Panel, window, card surface (elevated) |
| `--card-2` | `#0B1F2E` | Inset / secondary surface |
| `--ink` | `#EEF4F7` | Primary text (cool near-white) + white primary button |
| `--ink-2` | `#BCCAD3` | Secondary text / body |
| `--muted` | `#8497A3` | Muted captions |
| `--faint` | `#5C707D` | Labels, eyebrow, mono meta |
| `--line` | `rgba(255,255,255,.11)` | Hairlines, borders |
| `--line-2` | `rgba(255,255,255,.055)` | Faint dividers |

**Accents** — three, each with one job:

| Token | Hex | Job |
|---|---|---|
| `--green` / `--green-2` | `#2FBE8C` / `#46D6A6` | Functional: agent, "live", status, success, success-ticks. Brand mint, brightened for dark. |
| `--peri` / `--peri-ink` | `#A7A1F2` / `#BDB6FF` | Display accent words, @mentions, comment highlights. |
| `--amber` | `#F2B469` | Cinematic warm glow — the laptop light. Used *sparingly*: the hero's primary CTA shimmer, one key highlight per section. Never for body text. |
| `--grad-accent` | `linear-gradient(100deg,#9E97F0,#C0A9EC 45%,#E0B6C6 80%,#F2C28A 100%)` | Display accent gradient: cool violet → warm amber, echoing sky→glow. |

Soft fills on dark: `--green-soft: rgba(47,190,140,.14)`, `--green-line: rgba(47,190,140,.34)`.
Code: `--code-bg:#05101A`, `--code-fg:#DCE6EC`, `--code-dim:#6E8290`.

## Typography

- **Display (cinematic hero):** `Instrument Serif` — large, airy, letter-spacing `-.018em`, line-height `.98`. Secondary words in `rgba(255,255,255,.5)` for two-tone contrast.
- **Headings (sections):** `Fraunces` (opsz high), weight ~440 — the editorial serif, now white on navy.
- **Body:** `Schibsted Grotesk` 400/500.
- **Mono / labels / meta:** `JetBrains Mono` — eyebrows lowercase, letter-spacing `.14–.18em`, color `--faint`.

## Surfaces & depth

- Cards/windows: `--card` fill, `1px solid --line`, radius `18px` (`--radius`), shadow is **glow-down** not drop: `0 30px 60px -30px rgba(0,0,0,.6)` plus a top inset hairline `inset 0 1px 0 rgba(255,255,255,.05)` to catch light.
- Glass (nav, switcher, hero CTA): `backdrop-filter: blur(12px)`, `background: rgba(255,255,255,.04)`, inset top-light `inset 0 1px 1px rgba(255,255,255,.12)`, optional `.liquid-glass` gradient border.
- Grain overlay: `mix-blend-mode: overlay`, opacity `.05` (on dark, multiply would crush — overlay keeps it filmic).
- Primary button: **white** (`--ink` bg, `--paper` text) — the brightest object on the page, used once per section.

## Motion

- One ambient + one scroll moment per section (unchanged cadence).
- Hero reveal is CSS `fade-rise` (staggered), not GSAP — the video is the spectacle.
- Accent glows pulse slowly (`beat`, 1.8–2.4s). Cursors/typing carry the "live" feel.
- `prefers-reduced-motion`: pause the video (poster frame), drop fade-rise.

## Section rhythm

Hero (full-bleed video, dark) → the page continues dark. The hero scrim's bottom edge fades to `--paper` so the video melts into the canvas — no hard seam. Alternate `--paper` / `--paper-2` bands. Header is transparent-white over the video, switches to `rgba(8,24,38,.8)` blurred once scrolled past the hero.

## Non-goals

- No pure black (`#000`) canvas — it's navy, to live with the video.
- No more than one amber moment per viewport.
- Don't re-introduce the warm-paper look on this variant; that lives on A/B.
