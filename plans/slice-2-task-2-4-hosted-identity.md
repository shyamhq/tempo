# Task 2.4 — Hosted identity (Slice 2)

## Problem

The Hosted VM (Tasks 2.5–2.6) needs to authenticate every MCP call back
to Worker. The existing three Bearer flavors don't fit:

- `sk_agent_*` is Workspace-wide and durable — wrong scope (a Hosted
  Session is per-Thread + short-lived).
- `sk_user_*` is User-scoped — Hosted is a process, not a User.
- Clerk JWT requires browser-side cookies — Hosted is headless.

We need a fourth flavor: `sk_hosted_*`, minted per Session, scoped to a
single Thread, ~1 hour expiry.

## The change

### 1. Stateless `sk_hosted_*` JWT

Slice 2 plan says "lives in memory; never persisted." Cheapest model
that satisfies that: **HS256-signed JWT** using a long-lived
`HOSTED_AUTH_SECRET` env var (mirrors `CLI_AUTH_SECRET`'s shape).

Claims:
- `kind: 'hosted'`
- `thread_id`
- `workspace_id`
- `session_id` (informational; used for log correlation)
- `iat`, `exp` (1 hour default)

Verification reads the secret from env, validates signature + expiry,
extracts claims. No DB lookup; no in-memory registry; no revocation
story (token expires).

### 2. `issueHostedToken(threadId)` in `cli-auth.ts`

Looks up the Thread's workspace, mints the JWT, returns
`{ token, expires_at, session_id }`.

```ts
export async function issueHostedToken(threadId: string): Promise<{
  token: string;
  session_id: string;
  expires_at: Date;
}> {
  const [thread] = await db
    .select({ workspace_id: threads.workspace_id })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread) throw new Error(`issueHostedToken: thread ${threadId} not found`);

  const sessionId = `hst_${rowId()}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const secret = new TextEncoder().encode(env.HOSTED_AUTH_SECRET);
  const jwt = await new jose.SignJWT({
    kind: 'hosted',
    thread_id: threadId,
    workspace_id: thread.workspace_id,
    session_id: sessionId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);
  return { token: `sk_hosted_${jwt}`, session_id: sessionId, expires_at: expiresAt };
}
```

The `sk_hosted_` prefix is just a marker for the auth middleware; the
JWT itself follows the prefix.

### 3. Extend the `Caller` union + `identify`

```ts
export type Caller =
  | { kind: 'agent'; workspaceId: string }
  | { kind: 'cli'; userId: string }
  | { kind: 'browser'; userId: string }
  | { kind: 'hosted'; threadId: string; workspaceId: string; sessionId: string };
```

`identify` gains a fourth branch in `auth.ts`:

```ts
if (token.startsWith('sk_hosted_')) {
  const jwt = token.slice('sk_hosted_'.length);
  try {
    const { payload } = await jose.jwtVerify(
      jwt,
      new TextEncoder().encode(env.HOSTED_AUTH_SECRET),
    );
    if (payload.kind !== 'hosted' || !payload.thread_id || !payload.workspace_id) {
      throw new ForbiddenError('bad_hosted_token');
    }
    return {
      kind: 'hosted',
      threadId: payload.thread_id as string,
      workspaceId: payload.workspace_id as string,
      sessionId: payload.session_id as string,
    };
  } catch {
    throw new ForbiddenError('bad_hosted_token');
  }
}
```

### 4. `authorizeThread` — fourth branch

Hosted is pre-authorized to *its own* threadId only. Any mismatch is a
403.

```ts
if (caller.kind === 'hosted') {
  if (caller.threadId !== threadId) throw new ForbiddenError('cross_thread');
  return caller.workspaceId;
}
```

### 5. `rejectAgent` — keep rejecting agent, also reject hosted from
   user-facing routes

SSE is for Dev/Browser, not for Hosted. Rename to `rejectNonUser` or
extend the predicate. Smaller diff: extend the predicate inline.

```ts
export const rejectAgent: RequestHandler = (req, res, next) => {
  if (req.caller.kind === 'agent' || req.caller.kind === 'hosted') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
};
```

(The name becomes slightly misleading but renaming touches every
mount site; documented inline. *Skipped: rename; add when a third
non-user kind appears.*)

### 6. Env var

`HOSTED_AUTH_SECRET` — same shape as `CLI_AUTH_SECRET`. Required at
Worker boot; missing throws.

## Deliberate simplifications (algorithm + ponytail)

- **No DB persistence.** JWT is self-validating. The slice-2 plan said
  "lives in memory; never persisted" — JWT achieves both with zero
  state.
- **No revocation list.** ~1 hour expiry IS the revocation. If a Sandbox
  is compromised, killing it ends the only place the token exists.
- **No per-Session in-memory registry.** Stateless verification means no
  registry to keep in sync across Worker restarts.
- **No refresh flow.** A Hosted Session is short-lived; the VM is
  reaped after ~10 min idle (Task 2.6). Sessions longer than the JWT
  expiry happen exactly when a Turn runs at the 55-minute mark —
  exceedingly rare for MVP; if it bites, bump expiry to 2 hours. Skip
  refresh.

## Alternatives considered

1. **Per-Session shared secret rotated on Worker boot.** Cleaner
   security story (compromise of the long-lived secret only matters
   for the current Worker boot). But: cross-Worker compatibility
   problems if Worker scales horizontally. MVP is single-Worker. The
   long-lived secret matches `CLI_AUTH_SECRET`'s precedent.
2. **DB-backed hosted_tokens table.** Adds a writer + reader, a
   migration, and a cleanup story. Slice 2 plan explicitly says "never
   persisted." JWT is the right answer.
3. **Reuse `sk_agent_*` semantics with a `hosted_thread_id` claim.**
   Conflates "Workspace API key the Dev gave us" with "ephemeral
   Hosted Session" — different blast radii, different rotation
   stories. Bad shape.

## Uncertainties

- **`HOSTED_AUTH_SECRET` rotation.** Long-lived secret means a leak is
  durable. MVP acceptance: rotate by deploying a new env var; tokens
  signed with the old secret expire within an hour. Document under
  AGENTS.md "Spotted but not fixed" with a "graduate to per-Worker-boot
  ephemeral secret if multi-Worker arrives" trigger.

## Layer assignment

- `apps/worker/src/auth.ts` — extend `Caller`, `identify`,
  `authorizeThread`, `rejectAgent`.
- `apps/worker/src/server/cli-auth.ts` — add `issueHostedToken`.
- `apps/worker/src/env.ts` — add `HOSTED_AUTH_SECRET` to the Zod env
  schema.

`issueHostedToken` lives in `cli-auth.ts` (now misnamed but the
file already handles token issuance broadly — the "cli" in the name is
historical). *Skipped: rename file; do it when a third token type
arrives.*

## Deletion test

- `Caller.kind = 'hosted'` — without it, Hosted has no authenticated
  identity; the entire Slice 2 acceptance check fails. **Earns its
  keep.**
- `issueHostedToken` — sole minting site. **Earns its keep.**
- `rejectAgent` extension — without it, a Hosted token could read SSE
  events from any Thread it knows the ID of. Real exposure. **Earns its
  keep.**

## Execution

```bash
bun add jose --filter @tempo/worker   # already a dep? check; jose is in worker.
# Edit env.ts to require HOSTED_AUTH_SECRET.
# Edit auth.ts + cli-auth.ts.
bun run typecheck
bun run lint
# Manual smoke:
#   - issue a token; decode the JWT; verify it carries thread_id + workspace_id.
#   - call a Worker route with Bearer sk_hosted_<jwt>; expect 200 if threadId matches.
#   - call with a mismatched threadId; expect 403 cross_thread.
```

## Acceptance

- typecheck + lint clean.
- code-simplifier + code-reviewer pass.
- Smoke steps above pass.

## Forward-links

- **Task 2.5** calls `issueHostedToken(threadId)` at VM provision time
  and passes the token into the Sandbox via env var
  `TEMPO_HOSTED_TOKEN`.
- **Task 2.6**'s runner reads `TEMPO_HOSTED_TOKEN` and sets it as the
  MCP transport's Authorization header.
