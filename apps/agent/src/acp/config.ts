// Tuning knobs for the ACP adapter session. Centralized so the Dev can
// adjust agent behavior without hunting through session.ts. Keep this file
// values-only — no imports beyond types, no logic.

// Tools the planning Agent is architecturally forbidden from invoking.
// Edit/Write would mutate the Dev's repo; the Plan is the only writeable
// output (system prompt §Identity). Enforced via _meta.claudeCode.options
// on newSession so a drifted or injection-prompted model can't reach them.
// Bash and WebFetch stay allowed — used for repo exploration + docs lookup.
export const DISALLOWED_TOOLS: readonly string[] = ['Edit', 'Write'];

// Extended Thinking budget per turn. Drives `agent_thought_chunk`
// notifications which surface as the Brain-icon trail step. 0 disables.
// Tune higher for harder planning, lower to cut token spend.
export const MAX_THINKING_TOKENS = 12_000;

// Grace period between SIGINT and SIGKILL when tearing down the adapter
// subprocess. Long enough for a clean ACP shutdown round-trip; short
// enough that a wedged adapter doesn't block exit.
export const ADAPTER_KILL_GRACE_MS = 5_000;
