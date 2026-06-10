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

---

## Question

Where should the Stop-agent button sit in the Thread view when the agent is mid-turn? Feature #1 from the agent-control brainstorm — let the Dev abort an in-flight turn when the agent is going down the wrong path.

## Artifact

`stop-button.html` — three variants, switch via `?variant=A|B|C` or the floating bar at the bottom.

## Variants

- **A — In activity widget.** The existing activity widget (the small card that surfaces what tool the agent is using) sits top-right of the Plan area. Stop button is an X in the widget's top-right corner. Contextual co-location: the same thing that tells you the agent is working is what stops it.
- **B — Floating bottom-right pill.** A persistent pill at the viewport bottom-right: pulsing dot + "Agent working · 12s" + a Stop button. Visible from any scroll position. The activity widget is hidden in this variant — the pill is the activity affordance.
- **C — Inline Discussion card.** A card prepended to the Discussion stream: "Agent is working…" with tool count and a Stop button bottom-right of the card. The stop lives in the same channel as the reply will appear in.

## Verdict

**Variant A — In activity widget.** Dev picked it on 2026-06-09. Keep the existing floating activity status as the affordance and add a small Stop icon button to it; no new persistent chrome introduced. Real implementation lives wherever the activity widget component already is in `apps/console/components/**`; the Stop click fires the cancel event from feature #1 of the agent-control brainstorm. Delete `stop-button.html` once the real Stop button ships in the activity widget.
