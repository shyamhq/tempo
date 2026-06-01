# Workflow text moves from CLI prompt to `tempo_attach` response

## Problem

When the Dev runs `tempo-agent connect <token>` today, the CLI fetches a server-rendered ~85-line markdown string (`apps/console/server/initial-prompt.ts`) and passes it to Claude as the positional prompt arg in `spawn-claude.ts:164`. Claude Code prints the prompt verbatim as the visible "user message," so the Dev's terminal opens with a wall of role frame + workflow steps + polling loop + reply-style examples + discussion guidance + tools list. The Thread title and description are appended at the bottom.

This is bad UX (the Dev sees an internal contract before anything happens) and the wrong shape architecturally: instructions about how to use MCP tools belong with the MCP tools, not in a positional CLI arg that exists *outside* the MCP protocol.

## Smallest concrete change

Three moves, all within existing files. No new files.

1. **`packages/contracts/src/mcp.ts`** — add `workflow: z.string()` to `AttachOutput`. One field.

2. **Workflow text becomes a field on the attach response.**
   - `apps/console/server/initial-prompt.ts` — rename `renderInitialPrompt(sessionId)` → `renderWorkflow()`. Drop the title/description parameters (they already come back in `thread` on the attach state) and the DB lookup. Body becomes the procedural sections only: role frame, polling loop with per-event handlers (including the `proposal_decided` case from yesterday's commit), and the `ScheduleWakeup` heartbeat instruction. Drop the per-tool style sections (Reply style + Discussion) — those move into tool descriptions in step 3.
   - `apps/console/app/api/sessions/[id]/state/route.ts` — include `workflow: renderWorkflow()` in the response object.
   - `apps/console/app/api/sessions/[id]/initial-prompt/route.ts` — delete the file.
   - `apps/agent/src/http-client.ts` — delete `getInitialPrompt` and its `sendText` helper if `sendText` has no other caller.
   - `apps/agent/src/connect.ts` — replace `const initialPrompt = await client.getInitialPrompt(session.session_id)` with a literal `'Call tempo_attach to begin.'`. The HTTP round-trip and the `logger.debug({ chars: initialPrompt.length }, ...)` both go away.

3. **Tool descriptions in `apps/agent/src/mcp-server.ts`** absorb the per-tool style:
   - `tempo_attach` description: `"Always call first. Returns Thread state — title, description, status — plus Plan, open Comments, Discussion messages, pending Round, last event cursor, and the workflow guide for this session. Call again after any session resume or context compact."`
   - `tempo_post_reply` description: short style block (three paragraphs max, designer-to-PM tone, markdown renders, don't paste full test output) + one good/bad example pair — same content that lives under "# Reply style" in today's prompt.
   - `tempo_post_discussion_message` description: keep the existing one-liner and add the "batch multiple Dev Messages into one Reply" rule + the "approach-level, not line-level — Plan is the artifact" line from today's "# Discussion" section.
   - Every other tool description stays as it is today.

The Dev's terminal now shows `> Call tempo_attach to begin.` instead of an 85-line wall. Claude's first action is the attach; the workflow lives in the tool result that only Claude reads.

## Alternatives considered

1. **Keep server-rendered workflow, just deliver it via the attach response (Option A from brainstorm).** Tradeoff: even the per-tool style (Reply tone, Discussion etiquette) would only be in Claude's context once, then survive only as remembered text. After a long session those rules erode quietly — the kind of failure that's hard to attribute. Rejected in favor of putting style with the tool that uses it (Option B).

2. **Push everything into tool descriptions; no workflow field at all (Option C from brainstorm).** Tradeoff: the role frame + polling loop become always-in-context tokens paid for on every turn forever. The polling loop is ~12 lines of procedure that has nothing to do with a single tool call — making it a tool description forces it to sit in context even when no tempo tool is in play. Rejected.

3. **Selected: hybrid (Option B).** Procedural workflow in the attach response (Claude reads it on connect/re-attach, doesn't pay per-turn tokens for it); per-tool style in the tool description (always present when the tool is even a candidate, catches drift at the moment of use). Tool descriptions grow by ~10 lines on two tools; the attach response gains one string field; the CLI prompt shrinks to one line; one HTTP route disappears.

## Uncertainties

- **`renderWorkflow()` is now static.** It takes no arguments and returns the same markdown for every Thread. Worth confirming: is there any per-Thread customization on the horizon (e.g., a workspace setting that toggles whether Discussion is allowed)? If yes, keep the function signature ready to accept context; if no, a plain `const WORKFLOW = ...` would do. Default: keep it a function with no args — same shape as today, easy to extend.
- **The CLI prompt one-liner is hardcoded in `connect.ts`.** That's fine — the workflow itself is server-rendered and re-delivered on every attach, so updating it doesn't need a CLI release. The one-liner is just a nudge, not a contract.
- **Tool description size.** `tempo_post_reply`'s description goes from 1 line to ~8 lines. Claude Code injects tool definitions into the model's tool list on every turn, so this is a per-turn token cost. Estimate: ~80 tokens for `tempo_post_reply`, ~50 for `tempo_post_discussion_message`. Acceptable; the alternative (style only in attach) silently drifts.
- **One existing event reference.** `apps/agent/src/spawn-claude.ts:31-36` has a comment about ScheduleWakeup that refers to "the server-rendered initial prompt." That comment becomes outdated — it now refers to the workflow field in the attach response. Update the comment, don't add new behavior.

## Layer assignment

- `renderWorkflow()` is a server module (`apps/console/server/initial-prompt.ts`). Server-side workflow text. No change in layer.
- `AttachOutput` lives in `packages/contracts/src/mcp.ts`. Contract-side. No new layer.
- Tool descriptions live in `apps/agent/src/mcp-server.ts`. Agent-side MCP wiring. No new layer.
- No new functions in any new file. No new abstractions.

## Deletion test

Each thing I'm deleting:

- **`/api/sessions/:id/initial-prompt` route + `getInitialPrompt` HTTP client + `sendText` (if dead)**: if removed in 6 months, the complexity reappears as… nothing. The replacement (workflow field on attach) is strictly fewer round-trips. Pure deletion, no pass-through.
- **The "you are the Tempo planning Agent..." preamble at the top of `initial-prompt.ts`** — kept, moved into the workflow string. Same content, different transport.
- **`renderInitialPrompt`'s DB lookup** (it queries thread title/description to splice into the prompt): pure removal. The Agent already has title/description from `tempo_attach`'s `thread` field.

Each thing I'm adding:

- **`workflow` field on `AttachOutput`**: one string field. If deleted in 6 months, the Agent loses its session orientation. That's load-bearing, not a pass-through.
- **Tool description text on two tools**: same content as today, different location. The per-tool rules are what catch quiet drift in long sessions; if removed, reply tone regresses to whatever Claude Code's default voice is.
- **The literal `'Call tempo_attach to begin.'`** in `connect.ts`: one line. If deleted, the CLI passes an empty prompt and Claude has nothing to do on boot. Load-bearing.

## Destructive actions

None. No `git push`, no migration, no destructive DB op, no package publish. Two file deletions are reversible via git.

One soft-destructive concern worth naming: removing the `/api/sessions/:id/initial-prompt` route while an older Agent CLI is still in use would break that older CLI's connect. The MVP doesn't ship the CLI as a versioned package yet (T12 says no tests, no published versions), so the Console and the Agent move in lockstep. No external consumers.

## Vocabulary check

- "Workflow" is the existing heading in `initial-prompt.ts` (`# Workflow`). Keeping the word.
- "Attach" is the existing tool name. Unchanged.
- "Initial prompt" goes away as a concept — there is no longer a prompt to render. The route name and the function name both drop the term.
