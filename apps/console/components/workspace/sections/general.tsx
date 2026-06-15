'use client';

import { useOrganization } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { SectionFrame } from '../settings-modal';

export function GeneralSection() {
  const router = useRouter();
  const { organization, membership, isLoaded } = useOrganization();
  const readOnly = membership?.role !== 'org:admin';

  const [name, setName] = useState('');
  useEffect(() => {
    if (organization?.name) setName(organization.name);
  }, [organization?.name]);

  const qc = useQueryClient();
  const flags = useQuery({
    queryKey: ['workspace-flags'],
    queryFn: () => api.getWorkspaceFlags(),
    enabled: !readOnly && isLoaded,
  });

  const toggleHosted = useMutation({
    mutationFn: (enabled: boolean) => api.updateWorkspace({ hosted_enabled: enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace-flags'] }),
    // Surface failure so the user knows the box didn't actually save. invalidate
    // still runs so the checkbox snaps back to the server value.
    onError: () => qc.invalidateQueries({ queryKey: ['workspace-flags'] }),
  });

  const save = useMutation({
    mutationFn: async (next: string) => {
      await api.updateWorkspace({ name: next });
      // organization.reload() refreshes the useOrganization context; the
      // switcher's useOrganizationList holds a separate cache, so
      // router.refresh() is needed to re-seed both via RSC.
      await organization?.reload();
      router.refresh();
    },
  });

  const dirty = !!organization && name.trim() !== organization.name && name.trim().length > 0;

  return (
    <SectionFrame
      title="General"
      description="Workspace identity. Visible to everyone in this workspace."
    >
      <div className="mb-8 flex items-center gap-5">
        <WorkspaceAvatar name={organization?.name ?? ''} imageUrl={organization?.imageUrl} />
        <div className="text-caption text-ink-subtle">
          Workspace avatar comes from your organization profile.
        </div>
      </div>

      <div className="mb-6 max-w-md">
        <label htmlFor="ws-name" className="mb-1.5 block text-caption font-medium text-ink-muted">
          Workspace name
        </label>
        <Input
          id="ws-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly || !isLoaded}
          maxLength={80}
          placeholder={!isLoaded ? 'Loading…' : ''}
        />
        {readOnly ? (
          <p className="mt-2 text-micro text-ink-tertiary">
            Only admins can change the workspace name.
          </p>
        ) : null}
      </div>

      <section className="mb-8 max-w-2xl border-t border-hairline pt-6">
        <h3 className="mb-1 text-body-sm font-medium text-ink">Hosted Agent</h3>
        <p className="mb-3 text-caption text-ink-subtle">
          Run the planning Agent in Tempo's infrastructure when no local
          <code className="mx-1 rounded bg-surface-2 px-1 py-0.5 text-micro">tempo-agent</code>
          CLI is connected. Costs are billed per-second; idle Sandboxes are
          reaped after ~10 minutes.
        </p>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            disabled={readOnly || !flags.data || toggleHosted.isPending}
            checked={!!flags.data?.hosted_enabled}
            onChange={(e) => toggleHosted.mutate(e.target.checked)}
            className="h-4 w-4 rounded border-hairline"
          />
          <span className="text-caption text-ink">
            {flags.data?.hosted_enabled ? 'Enabled' : 'Disabled'}
            {toggleHosted.isPending ? ' (saving…)' : ''}
          </span>
        </label>
        {toggleHosted.isError ? (
          <p className="mt-2 text-micro text-danger">
            Failed to save. The setting was rolled back.
          </p>
        ) : null}
        {readOnly ? (
          <p className="mt-2 text-micro text-ink-tertiary">
            Only admins can change Hosted Agent settings.
          </p>
        ) : null}
      </section>

      <footer className="mt-10 flex justify-end gap-2 border-t border-hairline pt-6">
        <Button
          variant="secondary"
          onClick={() => organization && setName(organization.name)}
          disabled={!dirty || save.isPending}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => save.mutate(name.trim())}
          disabled={!dirty || save.isPending || readOnly}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </footer>
    </SectionFrame>
  );
}

function WorkspaceAvatar({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl: string | null | undefined;
}) {
  if (imageUrl) {
    return <img alt={name} src={imageUrl} className="h-16 w-16 shrink-0 rounded-lg object-cover" />;
  }
  return (
    <span
      aria-hidden
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-ink text-heading-3 font-semibold text-on-primary"
    >
      {(name || 'W')[0]?.toUpperCase()}
    </span>
  );
}
