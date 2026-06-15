# Slice 1c — Migrate MCP routes + reshape `apps/agent` (rough stub)

**Status:** rough stub for cross-slice coherence. Full plan + `judge` gate
land when 1c starts.

## Scope (one paragraph)

Move the 17 MCP-adjacent endpoints (12 plan/conversation/coordination + 5
status/session) and the ~14 server modules they depend on from
`apps/console/server/**` to `apps/worker/src/`. Register the full
`tempo_*` MCP surface (10 tools) on Worker's MCP endpoint. Re-point
browser-side writes (comment-add, plan-edit, reply, discussion-message,
attachments-init) from Console's HTTP routes to Worker over CORS + Clerk
session-token auth. Reshape `apps/agent` from "CLI with embedded SDK
loop" into a thin `tempo-agent init <token>` bootstrap that writes
`.mcp.json` + `/tempo-plan` slash command + Claude Code hook configs.
Delete the embedded Claude Agent SDK loop (~700 LOC). Move the skills
bundle and `r2-fetcher` from CLI to Worker.

## Directories `apps/worker/src/` gains

```
apps/worker/src/
├── (existing from 1b: index.ts, env.ts, logger.ts, auth.ts, mcp/, routes/)
├── server/                      domain modules lifted from apps/console/server/
│   ├── plan.ts                  ← from apps/console/server/plan.ts
│   ├── plan/block-html.ts       ← from apps/console/server/plan/block-html.ts
│   ├── comments.ts              ← from apps/console/server/comments.ts
│   ├── replies.ts               ← from apps/console/server/replies.ts
│   ├── discussion.ts            ← from apps/console/server/discussion.ts
│   ├── threads.ts               ← partial — agent-facing methods only
│   ├── sessions.ts              ← from apps/console/server/sessions.ts
│   ├── status.ts                ← from apps/console/server/status.ts
│   ├── event-log.ts             ← from apps/console/server/event-log.ts
│   ├── events-stream.ts         ← long-poll + SSE
│   ├── attachments.ts           ← from apps/console/server/attachments.ts
│   ├── actor.ts                 ← workspace + Clerk session resolution
│   └── db-queries/
│       └── plans.ts             ← lifted
├── mcp/
│   ├── server.ts                (existing; now registers 10 tools instead of 1)
│   ├── transport.ts             (existing)
│   └── tools/
│       ├── attach.ts            (existing; reads via Worker `server/` modules now)
│       ├── pull-plan.ts
│       ├── update-plan.ts
│       ├── update-block.ts
│       ├── add-blocks.ts
│       ├── delete-block.ts
│       ├── poll.ts              (long-poll wrapper on events-stream)
│       ├── post-reply.ts
│       ├── post-discussion-message.ts
│       ├── set-thread-meta.ts
│       └── load-skill.ts        (reads from worker/src/skills/ bundle)
├── routes/
│   ├── health.ts                (existing)
│   ├── browser/                 new — routes for the Console browser to call
│   │   ├── threads.ts
│   │   ├── comments.ts
│   │   ├── replies.ts
│   │   ├── discussion-messages.ts
│   │   ├── plan.ts              (browser editor save path)
│   │   └── attachments.ts
│   └── events/
│       ├── sse.ts               browser SSE stream
│       └── long-poll.ts         agent long-poll
├── skills/                       lifted bundle (.md files + loader)
│   ├── loader.ts
│   └── *.md
└── lib/
    └── r2.ts                     lifted from apps/agent/src/r2-fetcher.ts
```

## Apps shape after 1c

- `apps/console/server/**` shrinks to **non-agent-shared** modules only:
  `workspaces.ts`, `spaces.ts`, `clerk-webhook.ts`, `email.ts`,
  `workflow.ts` (or moved to a shared package per the judge's 1b note 3).
- `apps/console/app/api/**` shrinks to browser routes that don't touch
  agent-shared tables: workspace admin, spaces, health, etc. The MCP-
  adjacent paths (`/api/threads/:id/plan/*`, `/api/comments/:id/replies`,
  `/api/sessions/*`, etc.) are deleted; browser code is updated to call
  Worker URLs instead.
- `apps/agent` is ~200 LOC: argv parsing, `.mcp.json` writer, slash-
  command writer, hook-config writer. Drops `@modelcontextprotocol/sdk`,
  `pino`, `pino-pretty` as runtime deps.

## Contract changes

- No changes to `@tempo/contracts/mcp` schemas — the wire is frozen.
- Possibly: lift `WORKFLOW` constant from `apps/console/server/workflow.ts`
  into `@tempo/contracts` (or a new `packages/shared` package) if 1b
  flagged the duplication for resolution here.
- New: browser HTTP contracts for the routes that move (currently
  implicit in Console's route handlers; reify into Zod schemas in
  `@tempo/contracts/http` if they're not already).

## Forward-compat constraints on slice 1b

The 1b implementer should leave **clean room** for everything above.
Specifically:

1. `apps/worker/src/server/` does not exist yet in 1b, but it will. Do
   NOT preempt by creating empty folders or stub re-exports.
2. `apps/worker/src/mcp/tools/` exists in 1b with one file (`attach.ts`).
   1c adds 9 more siblings without modifying the pattern.
3. `apps/worker/src/routes/` exists with `health.ts`. 1c adds the
   `browser/` and `events/` subdirectories without restructuring.
4. `apps/worker/src/auth.ts` validates the workspace API key. 1c adds
   Clerk session-token validation for the browser-direct path. This will
   probably mean `apps/worker/src/auth.ts` splits into `auth/workspace.ts`
   and `auth/clerk-session.ts`, but that split happens in 1c — 1b just
   ships the workspace-key one.

## Judge gate

Required (contract surface change + Console code edits + CLI rewrite +
new browser↔Worker auth path). Full plan + judge invocation when 1c
starts.
