'use client';

import { useClerk, useOrganization, useUser } from '@clerk/nextjs';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useWorkspaceSettings } from '@/store/workspace-settings';
import { SectionFrame } from '../settings-modal';

export function DangerZoneSection() {
  const clerk = useClerk();
  const { user } = useUser();
  const closeModal = useWorkspaceSettings((s) => s.closeModal);
  const { organization: ws, membership } = useOrganization();
  const isAdmin = membership?.role === 'org:admin';

  // Both leave and delete invalidate the active Clerk org. signOut() drops the
  // session cleanly; any router.refresh() would otherwise hit a server that
  // can't resolve the dead org_id.
  const wipeSession = () => {
    closeModal();
    void clerk.signOut({ redirectUrl: '/sign-in' });
  };

  const leave = useMutation({
    mutationFn: () => api.removeMember(user?.id as string),
    onSuccess: wipeSession,
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Could not leave workspace.';
      window.alert(
        msg.includes('last_admin') ? "You're the last admin — promote someone else first." : msg,
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteWorkspace(),
    onSuccess: wipeSession,
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Could not delete workspace.';
      window.alert(msg);
    },
  });

  return (
    <SectionFrame title="Danger zone" description="These actions can't be undone.">
      <div className="space-y-3">
        <DangerRow
          title="Leave workspace"
          body="You'll lose access to all threads, plans, and comments in this workspace."
          button={
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(`Leave ${ws?.name ?? 'this workspace'}?`)) leave.mutate();
              }}
              disabled={!user || leave.isPending}
            >
              {leave.isPending ? 'Leaving…' : 'Leave workspace'}
            </Button>
          }
        />

        {isAdmin ? (
          <DangerRow
            title="Delete workspace"
            body="Permanently delete this workspace and every thread inside it. There is no recovery."
            button={
              <Button
                variant="danger"
                onClick={() => {
                  const ok = window.confirm(
                    `Permanently delete ${ws?.name ?? 'this workspace'}? This cannot be undone.`,
                  );
                  if (ok) remove.mutate();
                }}
                disabled={remove.isPending}
              >
                {remove.isPending ? 'Deleting…' : 'Delete workspace'}
              </Button>
            }
          />
        ) : null}
      </div>
    </SectionFrame>
  );
}

function DangerRow({
  title,
  body,
  button,
}: {
  title: string;
  body: string;
  button: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 rounded-lg border border-hairline bg-canvas px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-caption-bold text-ink">{title}</h3>
        <p className="mt-1 max-w-md text-caption text-ink-subtle">{body}</p>
      </div>
      <div className="shrink-0">{button}</div>
    </div>
  );
}
