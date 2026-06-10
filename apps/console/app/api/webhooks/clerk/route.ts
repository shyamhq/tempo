import type { WebhookEvent } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { handleClerkEvent } from '../../../../server/clerk-webhook';
import { logger } from '../../../../logger';

const SECRET = process.env.CLERK_WEBHOOK_SECRET;

export async function POST(req: NextRequest): Promise<Response> {
  if (!SECRET) return new NextResponse('CLERK_WEBHOOK_SECRET unset', { status: 500 });

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse('missing svix headers', { status: 400 });
  }

  const body = await req.text();
  let event: WebhookEvent;
  try {
    event = new Webhook(SECRET).verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as WebhookEvent;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'clerk-webhook: signature verification failed');
    return new NextResponse('invalid signature', { status: 401 });
  }

  try {
    await handleClerkEvent(event);
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error({ err: (e as Error).message, eventType: event.type }, 'clerk-webhook: handler failed');
    // Return 500 so Clerk retries — the handlers are idempotent.
    return new NextResponse('handler error', { status: 500 });
  }
}
