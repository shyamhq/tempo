import { renderInitialPrompt } from '../../../../../server/initial-prompt';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const text = await renderInitialPrompt(id);
  if (text == null) {
    return new Response('session not found', { status: 404 });
  }
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
