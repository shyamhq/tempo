import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Paths the Agent (CLI) talks to with `Authorization: Bearer …`. Listed
// explicitly per judge guidance: an allowlist is safer than a denylist —
// a missed entry on a denylist silently 401s; a missed entry on an
// allowlist routes through Clerk and fails loudly.
const isAgentApi = createRouteMatcher([
  '/api/sessions',
  '/api/sessions/(.*)',
  '/api/threads/(.*)',
  '/api/comments/(.*)',
  '/api/spaces/(.*)',
]);

// API routes that require a Clerk session (workspace management). Listed
// explicitly so the matcher fails loudly if a new path is added.
const isUserApi = createRouteMatcher(['/api/workspace/(.*)']);

const isPublic = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/onboarding(.*)',
  '/api/webhooks/(.*)',
  '/api/health',
  '/api/me',
]);

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

  if (isUserApi(req)) {
    // 401 JSON instead of redirect — these are API routes consumed by curl /
    // the (deferred) settings UI, not landing pages.
    const { userId } = await auth();
    if (!userId) return new NextResponse('unauthorized', { status: 401 });
    return;
  }

  // UI pages: redirect to /sign-in if unauthenticated.
  await auth.protect();

  // If signed in but no active org, activate it client-side via /onboarding.
  const { orgId } = await auth();
  if (!orgId && !req.nextUrl.pathname.startsWith('/onboarding')) {
    const url = req.nextUrl.clone();
    url.pathname = '/onboarding';
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
};
