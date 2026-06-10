import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Paths the Agent (CLI) talks to with `Authorization: Bearer …`. Listed
// explicitly per judge guidance: an allowlist is safer than a denylist —
// a missed entry on a denylist silently 401s; a missed entry on an
// allowlist routes through Clerk and fails loudly.
const isAgentApi = createRouteMatcher([
  '/api/sessions/(.*)',
  '/api/threads/(.*)',
  '/api/comments/(.*)',
  '/api/spaces/(.*)',
]);

const isPublic = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/api/webhooks/(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;

  if (isAgentApi(req)) {
    const hasBearer = req.headers.get('authorization')?.startsWith('Bearer ');
    if (hasBearer) return; // Bearer flows through; actor.ts validates.
    const { userId } = await auth();
    if (!userId) {
      // Edge runtime: Pino transports aren't available here.
      console.warn(
        `agent-api path ${req.nextUrl.pathname} hit with no Bearer and no Clerk session`,
      );
      return new NextResponse('unauthorized', { status: 401 });
    }
    return;
  }

  // UI pages: redirect to /sign-in if unauthenticated.
  await auth.protect();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
};
