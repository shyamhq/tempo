// Plan feature client. The plan write goes to the Worker (Bearer Clerk JWT),
// mirroring apps/console's workerApi().writePlan — the plan POST route lives on
// the Worker, not Console (same as comment/reply create). Both Dev and Agent
// write through this single endpoint; the Worker stamps `updated_by_user_id`
// from the caller (the Dev's user id for a browser write, null for the Agent),
// then emits a `plan_edited_by_dev` / `plan_edited_by_agent` event the gateway
// echoes back.
//
// The canonical plan body is read back through the Console-side thread GET
// (`getThread`) — there is no Worker plan-read route, and refetching the whole
// thread is the same all-or-nothing read hydration uses. getToken is passed
// per-call (useAuth().getToken) so every write carries a fresh JWT — never
// cached.

import type { Plan } from '@tempo/contracts';
import { GetThreadResponse, type WritePlanRequest, WritePlanResponse } from '@tempo/contracts/http';
import type { z } from 'zod';
import { request, workerBeacon, workerRequest } from '../../lib/api-client';

export function writePlan(
  threadId: string,
  input: z.input<typeof WritePlanRequest>,
  getToken: () => Promise<string | null>,
) {
  return workerRequest(
    'POST',
    `/api/threads/${encodeURIComponent(threadId)}/plan`,
    input,
    WritePlanResponse,
    getToken,
  );
}

// Page-unload flush of pending plan edits. Same POST route as writePlan, but
// fire-and-forget over a keepalive beacon with a synchronously-supplied token —
// a `beforeunload` handler cannot await getToken(). Last-write-wins on the
// server makes a double-write (beacon + an in-flight save both landing) safe.
export function beaconPlan(
  threadId: string,
  input: z.input<typeof WritePlanRequest>,
  token: string,
): void {
  workerBeacon(`/api/threads/${encodeURIComponent(threadId)}/plan`, input, token);
}

// Re-read the canonical plan body. Used by the gateway's onPlanEdited seam to
// refresh the slice after an external (Agent) edit so the live editor reloads.
export function getPlan(threadId: string): Promise<Plan> {
  return request(
    'GET',
    `/api/threads/${encodeURIComponent(threadId)}`,
    undefined,
    GetThreadResponse,
  ).then((view) => view.plan);
}
