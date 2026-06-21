# console-redo — Console rewrite plan

Status: draft, pending algorithm/standards review + explicit go.
Owner: Dev (gmeher360). Author: Claude Code.

## Problem

The Console (`apps/console`) accreted under launch pressure. The drafts and demo
UI need to be redone to a new design-system standard. Concretely:

- Live state is split across two sources of truth — the TanStack Query cache and
  Zustand — with the routing logic tangled into `hooks/use-thread-events.ts`.
- The BlockNote comment integration is hand-rolled against the editor's
  internals (`comment-thread-bridge.ts`, ~280 lines) instead of its documented
  API, and the thread orchestrator files run 450–550 lines.
- Styling is ad-hoc Tailwind with no canonical token layer.

We have a complete design system ready (`Design System Planning Tool/`) and want
to adopt it. The backend (contracts, server logic, wire format) is sound and
stays. This is a **client rewrite**, not a backend change.

## Goals

- A new app `apps/console-redo` built from scratch to the new design standard.
- One SSE gateway → one normalized Zustand store of record (kill the dual cache).
- BlockNote kept but rewired via its documented pattern; delete the monolith.
- Design system adopted as `--tp-*` tokens → Tailwind v4 `@theme` → shadcn/Radix.
- Nothing hand-rolled where a library is the standard shape.

## Non-goals

- The landing page is **out of scope** and untouched.
- No changes to `packages/contracts`, `packages/server`, `packages/db`,
  `packages/sse-client`, or the worker's SSE endpoint.
- No schema migration, no new event kinds, no new MCP tools.

## Decisions (confirmed with Dev)

1. **State / SSE gateway** — Zustand is the single source of truth for live thread
   state. One SSE gateway dispatches every event (by kind + id) into the slices.
   The live thread path uses no TanStack Query — hydration is a plain fetch that
   seeds the slices. TanStack Query is kept only for non-realtime server data
   (sidebar / settings / dashboard lists), where there is no SSE stream to
   compete with. (Refined from the original "Query for hydration + mutations"
   after the algorithm review showed Query-as-read-cache reintroduces the dual
   source of truth this rewrite exists to kill.)
2. **Editor** — keep BlockNote; rebuild the comment/anchor integration via its
   documented default-UI-flags + Controller-children path; delete the bridge.
3. **Design system** — adopt `--tp-*` tokens as CSS variables, map into Tailwind
   v4 `@theme`, build primitives with shadcn/Radix themed to the tokens. The
   kit's inline-styled components are the visual spec, not the shipped code.
4. **Server layer** — reuse the backend. console-redo gets its own thin
   `app/api/**` that parse → validate via contracts → call `packages/server` →
   format. No business logic in the new app.

## Architecture

### Repo shape

- New app `apps/console-redo` (own `package.json`, Next 16 / React 19, port 3000),
  added to the workspace + turbo. Built alongside `apps/console` — run one Console
  at a time during dev (Clerk callbacks target 3000; stop `apps/console` first).
- Shared/untouched: `packages/contracts`, `packages/server`, `packages/db`,
  `packages/sse-client`, worker SSE.
- During dev, console-redo shares `apps/console`'s `data/tempo.db` + env so
  existing threads appear. (See Uncertainties.)
- Cutover (point dev/build at console-redo, delete `apps/console`) is the final
  task and a destructive action requiring explicit Dev sign-off at that time.

### Design-system layer

- Copy `Design System Planning Tool/tokens/*.css` verbatim as the canonical
  `--tp-*` variables (color, type, spacing, radii, shadow, motion, dark mode).
- One mapping file exposes the tokens to Tailwind v4 `@theme` by referencing the
  CSS vars (`--color-accent: var(--tp-accent)`) — zero hex/rgba restated in the
  mapping. Pre-computed wash tokens (`--tp-success-bg` etc.) map through as-is.
- Primitives via shadcn/Radix themed to tokens: Button, IconButton, Input, Card,
  Badge, Pill, Avatar, Banner, Segmented — matching the kit's contracts but
  getting Radix accessibility. Brand rules (borders define surfaces, no card
  shadows, sentence case, terracotta sparingly) live in the components.

### State architecture

- **Zustand slices** are the only thing components read for live thread state.
  Collections stay as plain ordered arrays — the server returns them ordered and
  every contract mutation is a 1–3 line map/filter. No `Record` + `order`
  normalization (that is a second thing to keep in sync):
  - `thread` — meta: title, repos, presence, vm
  - `comments` — `Comment[]`, replies nested under each comment (replies have no
    independent lifecycle; the server already nests them in `GetThreadResponse`)
  - `discussion` — `DiscussionMessage[]`
  - `plan` — body + meta (updated_at, updated_by)
  - `agent` — port `apps/console/store/agent-messages.ts` as-is (persisted + live
    keyed by threadId, with the `readUIMessageStream` assembler); not re-designed
  - `sidebar` — spaces/threads tree
  - `ui` — rail/dock/density/seen (persisted to localStorage)
- **The gateway** (`lib/event-gateway.ts`): one `subscribeToEvents()` per active
  thread. It first handles the three SSE-only frames that are NOT in the `Event`
  union — `presence`, `vm`, `agent_chunk` (guard each before parsing the union) —
  then a single `switch` over `EventKind` with a `default: never` exhaustiveness
  check. The language gives exhaustiveness for free; no reducer-table indirection,
  and the table would mislead anyway since several kinds write no slice and three
  frames live outside the union. Each case writes its slice. The gateway owns the
  `Last-Event-ID` cursor + reconnect. This is the centralized reactive mechanism:
  everything in one door, fanned out by type + id.
- **No TanStack Query in the live thread path.** Hydration is one authenticated
  `fetch` on thread-open that seeds the slices; after that the gateway is the only
  writer of remote thread state. Query is kept only for the non-realtime surfaces
  (sidebar / settings / dashboard) — its actual sweet spot.
- **Mutations**: plain POST → optimistic write to the slice → the gateway dedups
  the server's echoed event by entity id. One reconciliation path; no Query
  optimistic-update machinery competing with the gateway's dedup.
- **Reconnect (preserve today's correct behavior)**: fresh Clerk JWT via
  `getToken()` on EVERY reconnect (mid-session expiry must not permanently 401 the
  stream); `Last-Event-ID` replay; and, only when reconnecting after a drop that
  outlived Redis retention, re-run the hydration fetch to re-seed. No
  heal-on-mount effects.
- **Agent live→persisted handoff (known sharp edge)**: on `agent_turn_ended` the
  live stream closes and the persisted UIMessage carries the same turn id — dedup
  by turn id on merge. This pipeline produced a duplicate-turn bug before;
  preserve the id-merge invariant.

### Editor & comments

- Keep BlockNote. Rebuild the integration via its documented default-UI flags +
  Controller children. Verify the installed BlockNote comments API via Context7
  before writing (standing rule — do not code from memory).
- Comments/anchors read/write through the `comments` slice (replies nested); the
  gateway applies remote comment events. Anchor highlights use `--tp-hl*` tokens.
- `comment-thread-bridge.ts` is deleted, not ported.

### Real-time specifics

- `agent_chunk` → fed into the AI SDK `readUIMessageStream()` assembler in the
  `agent` slice; finalized on `agent_turn_ended`.
- `presence` / `vm` → transient fields on the `thread` slice (status pills).
- `shouldWake`, `WAKE_KINDS`, author-filtering stay server-side. The client
  renders what it receives.

## Folder structure & boundaries

Feature-based colocation — the bulletproof-react / Feature-Sliced-Design
consensus, not layer-based grouping. The hard rule stays: **components are
presentational** — a component reads state via Zustand selectors and triggers
behavior by calling slice actions. It never calls `fetch`, never validates a wire
shape, never holds a business rule.

```
apps/console-redo/
├── app/                              # routing only
│   ├── (auth)/sign-in/
│   ├── (app)/
│   │   ├── layout.tsx                # 3-zone shell; composes <Sidebar/> + outlet
│   │   ├── page.tsx                  # dashboard
│   │   └── t/[threadId]/page.tsx     # composes plan + comments + discussion + agent
│   ├── api/                          # thin handlers → packages/server
│   ├── layout.tsx                    # root: Clerk, fonts, token import
│   └── globals.css                   # @import tokens + @theme mapping
├── features/                         # each feature owns its full stack
│   ├── thread/     components/  store.ts  api.ts   # meta: title, repos, presence, vm
│   ├── plan/       components/  store.ts  api.ts   # BlockNote editor + plan body
│   ├── comments/   components/  store.ts  api.ts   # comments + replies + anchors
│   ├── discussion/ components/  store.ts  api.ts
│   ├── agent/      components/  store.ts  api.ts   # UIMessage parts, live assembly
│   ├── sidebar/    components/  store.ts  api.ts   # spaces/threads nav
│   └── workspace/  components/  store.ts  api.ts   # settings
├── components/ui/                    # SHARED shadcn/Radix primitives, themed to tokens
├── store/
│   ├── index.ts                      # composition root: combines feature slices + ui → useThreadStore
│   └── ui.ts                         # global UI slice (rail/dock/density/seen) — not feature-specific
├── lib/
│   ├── api-client.ts                 # base fetch (auth + error normalization) — the ONLY raw fetch
│   ├── event-gateway.ts              # one SSE subscription → useThreadStore actions
│   └── query-client.ts               # TanStack Query setup (non-realtime surfaces only)
├── hooks/                            # shared lifecycle glue (useThreadSession)
└── middleware.ts                     # Clerk
```

**Organizing rules (enforced, not aspirational):**

- **Group by feature, not file type.** Each `features/<name>/` owns its
  `components/` + `store.ts` slice + `api.ts`. Flat files until a feature needs a
  folder — no foldering for one file.
- **No cross-feature imports.** `comments` never imports `discussion`; enforced
  with eslint `import/no-restricted-paths`. Composition happens only in `app/` and
  in the store composition root.
- **One-way dependencies:** shared (`lib`, `components/ui`) → `features` → `app`.
- **No barrel `index.ts`** re-exports (hurts tree-shaking) — import directly.

**How the slice + gateway lock together (so logic never leaks into components):**

- Each `features/<name>/store.ts` exports `createXxxSlice: StateCreator<Store, [],
  [], XxxSlice>` — state **+ actions + the event-apply reducers**, colocated
  (Zustand slices pattern). This is "Zustand to its best".
- **`store/index.ts` is the one composition root** — the only place that imports
  every feature slice, combined into a single `useThreadStore`.
- **`lib/event-gateway.ts`** depends only on `useThreadStore`; its `switch` calls
  `getState().applyCommentAdded(e)` etc. — never reaching into feature internals.
- A feature component reads via selector and calls a slice action; the action
  calls the feature `api.ts`, which uses shared `lib/api-client.ts`. Components
  never see `fetch`, Zod, or a business rule.

### Server-side layer (reused, unchanged)

- DB/query + business rules: `packages/server`.
- console-redo `app/api/**`: thin parse → validate → call server → format.

## Task breakdown (each task = one independent commit)

Commit mechanic: I commit after your OK. Infra tasks need a quick approval; UI
tasks you test first. Test gates marked **[GATE]**.

### Phase 0 — Scaffold (infra)
- T0.1 Create `apps/console-redo` Next 16 skeleton; wire workspace + turbo; boots.
- T0.2 Tailwind v4 + copy tokens + `@theme` mapping + fonts in root layout.
- T0.3 shadcn init themed to tokens.
- T0.4 Clerk wiring (middleware, provider, env, auth gate).

### Phase 1 — Design-system primitives
- T1.1 Core primitives via shadcn themed to tokens.
- T1.2 `/kitchen-sink` route rendering all primitives, light + dark. **[GATE]**

### Phase 2 — State core
- T2.1 Zustand slices + types + selectors (shapes only).
- T2.2 Event gateway: subscribe + SSE-frame pre-guard + exhaustive `switch`
  dispatch (`default: never`) + cursor/reconnect (per-reconnect token refresh).
- T2.3 Hydration (fetch → seed slices) + mutation pattern (optimistic write +
  gateway echo-dedup), proven on `comment_added` + reply dedup (the path that
  actually stresses the gateway, not thread rename). **[GATE]**

### Phase 3 — App shell + sidebar
- T3.1 Three-zone app layout from the Workbench kit.
- T3.2 Sidebar: spaces/threads tree, presence dots, nav, rename/delete. **[GATE]**

### Phase 4 — Thread view: plan editor + comments (the BlockNote rewire)
- T4.1 BlockNote plan editor; plan load/save via slice + api (Context7 first).
- T4.2 Comments + anchors via documented pattern; resolve/unresolve/delete.
- T4.3 Comment card/gutter UI themed (`--tp-hl*`). **[HARD GATE — Dev-flagged]**

### Phase 5 — Discussion + agent activity
- T5.1 Discussion panel (messages + composer) wired to slice + gateway.
- T5.2 Agent activity: agent_chunk assembler, persisted UIMessages, turn states,
  presence/vm pills. **[GATE]**

### Phase 6 — Settings, dashboard, parity, cutover
- T6.1 Workspace settings (members, agent key, connectors).
- T6.2 Dashboard / home.
- T6.3 Parity sweep + fixes. **[GATE — full walkthrough]**
- T6.4 Cutover: repoint dev/build, delete `apps/console`. **[Destructive — explicit
  Dev sign-off required]**

## Review cadence

- Each task ends with the review trio (code-simplifier, code-reviewer, standards/
  algorithm pass) before it is offered for commit, per CLAUDE.md.
- After each phase that renders UI, I stop and hand you a click-through.

## Testing

One Playwright browser, you log into Clerk once, I reuse that context for every
phase's verification (never closing the window — standing rule). Phases 0–2 have
little to see; from phase 3 on, each gate is a real click-through.

## Alternatives considered

- **State**: gateway → Zustand-of-record (chosen) vs. gateway patches Query cache
  (keeps the dual source of truth) vs. pure Zustand, no Query (re-implements
  retry/dedup/optimism). Chosen option is the single-source realization of the
  Dev's vision.
- **Editor**: BlockNote rewire (chosen, lowest risk, keeps native comments) vs.
  Tiptap (reimplement comments from scratch) vs. Plate/Lexical (largest rewrite).
- **Design system**: tokens + Tailwind + shadcn/Radix (chosen, library-backed
  a11y) vs. copy inline-styled primitives (hand-rolled, no a11y) vs. tokens +
  custom components (own all primitive behavior).
- **Server**: reuse backend, rewrite client (chosen) vs. rewrite handlers vs.
  full rewrite incl. server modules.

## Uncertainties

- Exact BlockNote comments API surface in the installed version — verify via
  Context7 before Phase 4, not from memory.
- Whether any current `app/api/**` handler carries non-thin logic that shouldn't
  be copied blindly — audit each as it is lifted.
- `data/tempo.db` is single-writer (libSQL/SQLite); two dev servers writing at
  once invites `SQLITE_BUSY`. Resolution: console-redo points at the same DB so
  existing threads appear, but we run only one Console at a time during dev.

## Deletion test

- Gateway + slices: deleting them removes real-time state assembly — not a
  pass-through; they earn their place.
- Token→`@theme` mapping file: deleting it breaks all theming — earns its place.
- console-redo `app/api/**`: thin re-bindings; justified because a separate Next
  app needs its own route handlers, but they hold no logic of their own.
