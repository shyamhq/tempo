'use client';

// General settings: workspace identity (name) + the agent key.
//
// Name → Clerk's organization.update({ name }) directly (the org IS the
// workspace; Clerk owns this fact, so no custom backend). organization.reload()
// refreshes the useOrganization context; router.refresh() re-seeds the switcher's
// separate useOrganizationList cache via RSC.
//
// Agent key → OUR DB (the masked key lives on the workspaces row, not in Clerk),
// so it flows through features/settings/api.ts. Admin-only: members can't read
// or rotate the workspace's CLI secret.

import { useOrganization } from '@clerk/nextjs';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAgentKey, rotateAgentKey } from '../../api';
import { SectionFrame } from '../section-frame';

export function GeneralSection() {
  const { membership, isLoaded } = useOrganization();
  const isAdmin = membership?.role === 'org:admin';

  return (
    <SectionFrame
      title="General"
      description="Workspace identity and the key your local agent connects with."
    >
      <WorkspaceName isReadOnly={!isAdmin} isLoaded={isLoaded} />
      <div className="my-8 h-px bg-border" />
      <AgentKey isAdmin={isAdmin} />
    </SectionFrame>
  );
}

function WorkspaceName({ isReadOnly, isLoaded }: { isReadOnly: boolean; isLoaded: boolean }) {
  const router = useRouter();
  const { organization } = useOrganization();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (organization?.name) setName(organization.name);
  }, [organization?.name]);

  const dirty = !!organization && name.trim().length > 0 && name.trim() !== organization.name;

  const save = async () => {
    if (!organization || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await organization.update({ name: name.trim() });
      // reload() refreshes the useOrganization context; the switcher holds a
      // separate useOrganizationList cache, so router.refresh() re-seeds it too.
      await organization.reload();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the workspace name.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md">
      <label htmlFor="ws-name" className="mb-1.5 block text-sm font-medium text-ink-2">
        Workspace name
      </label>
      <Input
        id="ws-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={isReadOnly || !isLoaded}
        maxLength={80}
        placeholder={isLoaded ? '' : 'Loading…'}
      />
      {isReadOnly ? (
        <p className="mt-2 text-xs text-ink-3">Only admins can change the workspace name.</p>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {dirty ? (
            <Button
              variant="secondary"
              onClick={() => organization && setName(organization.name)}
              disabled={saving}
            >
              Cancel
            </Button>
          ) : null}
          {error ? <span className="text-xs text-danger">{error}</span> : null}
        </div>
      )}
    </div>
  );
}

function AgentKey({ isAdmin }: { isAdmin: boolean }) {
  // Members never see the key at all — it's the workspace's CLI Bearer secret.
  if (!isAdmin) {
    return (
      <div className="max-w-md">
        <div className="mb-1.5 text-sm font-medium text-ink-2">Agent key</div>
        <p className="text-xs text-ink-3">Only admins can view or rotate the agent key.</p>
      </div>
    );
  }
  return <AgentKeyAdmin />;
}

function AgentKeyAdmin() {
  const [masked, setMasked] = useState<string | null>(null);
  // The full key is only ever held in memory right after a rotation — the reveal.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    getAgentKey()
      .then((k) => live && setMasked(k))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load the key.'));
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const display = revealed ?? masked ?? '…';

  const rotate = async () => {
    if (!window.confirm('Rotate the agent key? Any connected CLI session will stop working.')) {
      return;
    }
    setRotating(true);
    setError(null);
    try {
      const next = await rotateAgentKey();
      setRevealed(next);
      // Drop the stale mask rather than reconstruct the server's format here —
      // `revealed` is what's shown while non-null, and the mask re-fetches on
      // next mount (single source of truth: server's maskKey).
      setMasked(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rotate the key.');
    } finally {
      setRotating(false);
    }
  };

  // Copy is only offered for the revealed full key — copying the masked value
  // would hand back a non-working token, and the full secret isn't re-fetchable
  // by design (rotate to mint a fresh, copyable one).
  const copy = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="max-w-lg">
      <div className="mb-1.5 text-sm font-medium text-ink-2">Agent key</div>
      <div className="flex items-center gap-2">
        <code className="flex h-[29px] min-w-0 flex-1 items-center truncate rounded-sm border border-border-strong bg-inset px-[11px] font-mono text-sm text-code-ink">
          {display}
        </code>
        {revealed ? (
          <Button variant="secondary" onClick={copy} icon={copied ? <Check /> : <Copy />}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={rotate} disabled={rotating} icon={<RefreshCw />}>
          {rotating ? 'Rotating…' : 'Rotate'}
        </Button>
      </div>
      {revealed ? (
        <p className="mt-2 text-xs text-warning">
          Copy this now — it won't be shown in full again.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      <p className="mt-3 text-xs text-ink-3">
        Connect your local agent with{' '}
        <code className="tp-code">npx tempo-agent connect &lt;token&gt;</code>.
      </p>
    </div>
  );
}
