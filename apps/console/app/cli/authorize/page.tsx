import { auth as clerkAuth, clerkClient } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { AuthorizeClient } from './authorize-client';

interface SearchParams {
  state?: string;
  port?: string;
  challenge?: string;
}

// Server component: resolves the Clerk session and passes safe props to the
// client component that handles the Allow / Deny interaction.
export default async function CliAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { state, port: portStr, challenge } = await searchParams;

  // Validate required params before hitting Clerk so the error is immediate.
  const port = portStr ? parseInt(portStr, 10) : NaN;
  if (!state || !challenge || Number.isNaN(port) || port < 1024 || port > 65535) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            Invalid or missing authorization parameters.
          </p>
        </div>
      </main>
    );
  }

  const { userId } = await clerkAuth();
  if (!userId) {
    redirect(
      `/sign-in?redirect_url=${encodeURIComponent(`/cli/authorize?state=${state}&port=${port}&challenge=${challenge}`)}`,
    );
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? '';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <AuthorizeClient email={email} state={state} port={port} challenge={challenge} />
    </main>
  );
}
