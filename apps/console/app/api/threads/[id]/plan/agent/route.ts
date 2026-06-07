import { AgentWritePlanRequest } from '@tempo/contracts/http';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../../../server/actor';
import { err, ok, parseBody } from '../../../../../../server/http';
import { getPlanForAgent, writePlanFromAgent } from '../../../../../../server/plan';

// Agent boundary for the Plan: GET returns annotated Markdown (Markdown +
// `⟦sty:…⟧` sentinels that preserve text colour and comment-thread anchors
// the agent can't express in Markdown). POST accepts the same form and
// decodes it back into blocks before writing. Stateless: the marker carries
// its own style payload, so nothing flows between the two calls except the
// Markdown itself.
//
// The Console UI never hits this route — it uses the blocks-native sibling
// at /api/threads/:id/plan. Only the Agent's MCP path goes through here.

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'agent' || auth.thread_id !== id) return err('unauthorized', 401);
  return ok(await getPlanForAgent(id));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'agent' || auth.thread_id !== id) return err('unauthorized', 401);
  const parsed = await parseBody(req, AgentWritePlanRequest);
  if (!parsed.ok) return parsed.response;
  const { updated_at } = await writePlanFromAgent(id, parsed.data.markdown);
  return ok({ ok: true, updated_at });
}
