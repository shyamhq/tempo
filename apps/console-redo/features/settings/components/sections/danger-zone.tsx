'use client';

// Danger zone — both actions go through Clerk directly (the org IS the workspace).
//   Leave  → the current user's own membership.destroy()
//   Delete → organization.destroy() (admin only)
// Both invalidate the active org, so we signOut() afterward: any router.refresh()
// would hit a server that can't resolve the now-dead org. window.confirm is the
// codebase's current destructive-confirm pattern (no dialog primitive yet).

import { useClerk, useOrganization } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clerkMessage } from '../../clerk-error';
import { SectionFrame } from '../section-frame';

export function DangerZoneSection() {
  const clerk = useClerk();
  const { organization, membership } = useOrganization();
  const isAdmin = membership?.role === 'org:admin';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgName = organization?.name ?? 'this workspace';

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      // Leave/delete kill the active org; drop the session cleanly.
      // ponytail: if organization.destroy() partially succeeds (org gone) but
      // signOut() then throws, the user is left in a stale session with a dead
      // org — the surfaced error tells them, and the next request 401s into
      // /sign-in via middleware. Not worth a compensating retry loop here; the
      // upgrade path is a server action that does both atomically if it bites.
      await clerk.signOut({ redirectUrl: '/sign-in' });
    } catch (e) {
      setError(clerkMessage(e, fallback));
      setBusy(false);
    }
  };

  return (
    <SectionFrame title="Danger zone" description="These actions can't be undone.">
      <div className="space-y-3">
        <DangerRow
          title="Leave workspace"
          body="You'll lose access to all threads, plans, and comments in this workspace."
          action={
            <Button
              variant="danger"
              disabled={!membership || busy}
              onClick={() => {
                if (membership && window.confirm(`Leave ${orgName}?`)) {
                  void run(
                    () => membership.destroy(),
                    'Could not leave — you may be the last admin. Promote someone else first.',
                  );
                }
              }}
            >
              Leave workspace
            </Button>
          }
        />

        {isAdmin ? (
          <DangerRow
            title="Delete workspace"
            body="Permanently delete this workspace and every thread inside it. There is no recovery."
            action={
              <Button
                variant="danger"
                disabled={!organization || busy}
                onClick={() => {
                  if (
                    organization &&
                    window.confirm(`Permanently delete ${orgName}? This cannot be undone.`)
                  ) {
                    void run(() => organization.destroy(), 'Could not delete the workspace.');
                  }
                }}
              >
                Delete workspace
              </Button>
            }
          />
        ) : null}

        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </SectionFrame>
  );
}

function DangerRow({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 rounded-lg border border-border bg-canvas px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-1 max-w-md text-sm text-ink-3">{body}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
