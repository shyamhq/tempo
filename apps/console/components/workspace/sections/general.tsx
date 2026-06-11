'use client';

import { useOrganization } from '@clerk/nextjs';
import { useMutation } from '@tanstack/react-query';
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
