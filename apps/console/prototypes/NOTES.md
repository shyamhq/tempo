# Prototype notes

## Question

What should the `/threads/new` compose surface look like — the single-textarea screen where a Dev types their first ask, which becomes the Thread's first Discussion Message?

## Artifact

`new-thread-compose.html` — three variants, switch via `?variant=A|B|C` or the floating bar at the bottom.

## Variants

- **A — Blank canvas.** Lovable/Bolt clone. Massive centred textarea, almost no chrome, two ghost actions in the toolbar, one example pill row below. The screen *is* the input.
- **B — Pre-rendered Thread shell.** The Thread page layout is already on screen (sidebar / Plan-skeleton centre / Discussion right). The Dev types into the right-rail Discussion composer; they see exactly where their words will land. Sidebar shows an italicised *Untitled thread* with a pulsing dot.
- **C — Structured intake.** A card with one required textarea ("What should change?") + clickable rails for *Files to look at*, *Out of scope*, *Constraints*, *Time budget*, *Related Threads*. Below: a live preview of the title the Agent will probably pick.

## Verdict

**Variant A — Blank canvas.** Dev picked it on 2026-06-04. Constraint added: drop the *@ Attach files*, */ Templates*, and example-pill ghost actions — we don't support those yet, don't surface them. The compose surface is a textarea + Start Thread button + keyboard hint, nothing else. Real implementation goes into `apps/console/app/threads/new/page.tsx` + `apps/console/components/dashboard/new-thread-compose.tsx`, using semantic tokens from `globals.css` and the existing `Button` component. Delete this prototype directory once the real route ships.
