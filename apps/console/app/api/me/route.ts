import { auth } from '@clerk/nextjs/server';

// Cross-origin session probe for the marketing site. The landing page is a
// static site on its own origin and can't read Clerk's HttpOnly session
// cookie, so it asks here ("am I signed in?") with a credentialed fetch and
// swaps its CTA to "Go to your dashboard" when the answer is yes.
//
// Credentialed CORS forbids `*`, so we reflect the request Origin only when
// it's allowlisted: any localhost in dev, LANDING_URL in prod. An unlisted
// origin gets 403 (fail loud — same allowlist philosophy as proxy.ts).

export const dynamic = 'force-dynamic';

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  // URL().hostname brackets IPv6, so loopback is '[::1]', not '::1'.
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (isLocalhost && process.env.NODE_ENV !== 'production') return origin;
  const landing = process.env.LANDING_URL;
  if (landing) {
    try {
      // Normalize so a trailing slash in the env value doesn't silently 403.
      if (origin === new URL(landing).origin) return origin;
    } catch {
      // Malformed LANDING_URL → no allowlist match.
    }
  }
  return null;
}

// ponytail: simple credentialed GET (no custom request headers) → no CORS
// preflight, so no OPTIONS handler needed. Add one if a header is introduced.
export async function GET(req: Request) {
  const requestOrigin = req.headers.get('origin');
  const origin = allowedOrigin(requestOrigin);
  if (!origin) {
    if (requestOrigin) {
      console.warn(
        `/api/me rejected origin ${requestOrigin} — not allowlisted (check LANDING_URL)`,
      );
    }
    return new Response('forbidden', { status: 403 });
  }
  const { userId } = await auth();
  return Response.json(
    { signedIn: !!userId },
    {
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin',
      },
    },
  );
}
