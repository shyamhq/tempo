'use client';

// Members settings — entirely on Clerk hooks (no /api/workspace/members route).
// useOrganization({ memberships, invitations }) gives the lists + each item's own
// mutators: membership.update({ role }) / membership.destroy() / invitation.revoke()
// and organization.inviteMember({ emailAddress, role }). Admin actions gate on the
// current user's membership.role; members get a read-only list. After a mutation
// we revalidate the affected list so the UI reflects Clerk's new state.

import { useOrganization, useUser } from '@clerk/nextjs';
import { Mail } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { clerkMessage } from '../../clerk-error';
import { SectionFrame } from '../section-frame';

const MEMBERS_PARAMS = {
  memberships: { infinite: true as const },
  invitations: { infinite: true as const },
};

type OrgRole = 'org:admin' | 'org:member';

// The membership-list element type, derived from the hook's own return so the
// item's mutators (.update / .destroy) and publicUserData stay fully typed by the
// SDK without pulling @clerk/types (a peer of @clerk/nextjs, not a direct dep).
type MembershipResource = NonNullable<
  NonNullable<ReturnType<typeof useOrganization<typeof MEMBERS_PARAMS>>['memberships']>['data']
>[number];

// The invitation-list element type, derived the same way so inv.revoke() and
// inv.emailAddress stay SDK-typed without pulling @clerk/types.
type InvitationResource = NonNullable<
  NonNullable<ReturnType<typeof useOrganization<typeof MEMBERS_PARAMS>>['invitations']>['data']
>[number];

export function MembersSection() {
  const { user } = useUser();
  const { isLoaded, organization, membership, memberships, invitations } =
    useOrganization(MEMBERS_PARAMS);
  const isAdmin = membership?.role === 'org:admin';

  if (!isLoaded || !organization) {
    return (
      <SectionFrame title="Members">
        <p className="text-sm text-ink-3">Loading…</p>
      </SectionFrame>
    );
  }

  const memberRows = memberships?.data ?? [];
  const inviteRows = invitations?.data ?? [];

  return (
    <SectionFrame title="Members" description="People with access to this workspace.">
      {isAdmin ? (
        <InviteForm
          onInvited={async (email, role) => {
            await organization.inviteMember({ emailAddress: email, role });
            await invitations?.revalidate?.();
          }}
        />
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        {memberRows.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            isSelf={m.publicUserData?.userId === user?.id}
            isAdmin={isAdmin}
            onChangeRole={async (role) => {
              await m.update({ role });
              await memberships?.revalidate?.();
            }}
            onRemove={async () => {
              await m.destroy();
              await memberships?.revalidate?.();
            }}
          />
        ))}
      </div>

      {isAdmin && inviteRows.length > 0 ? (
        <>
          <div className="mb-2 mt-6 text-2xs font-semibold uppercase tracking-label text-ink-3">
            Pending invitations
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            {inviteRows.map((inv) => (
              <InviteRow
                key={inv.id}
                invitation={inv}
                onRevoke={async () => {
                  await inv.revoke();
                  await invitations?.revalidate?.();
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </SectionFrame>
  );
}

function InviteForm({ onInvited }: { onInvited: (email: string, role: OrgRole) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('org:member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = isEmailLike(email);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onInvited(email.trim(), role);
      setEmail('');
    } catch (e) {
      setError(clerkMessage(e, 'Could not send the invitation.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-[220px] flex-1">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          icon={<Mail />}
        />
      </div>
      <Segmented
        value={role}
        onChange={(v) => setRole(v as OrgRole)}
        options={[
          { value: 'org:member', label: 'Member' },
          { value: 'org:admin', label: 'Admin' },
        ]}
      />
      <Button variant="primary" onClick={submit} disabled={!valid || busy}>
        {busy ? 'Inviting…' : 'Invite'}
      </Button>
      {error ? <span className="w-full text-xs text-danger">{error}</span> : null}
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  isAdmin,
  onChangeRole,
  onRemove,
}: {
  member: MembershipResource;
  isSelf: boolean;
  isAdmin: boolean;
  onChangeRole: (role: OrgRole) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pub = member.publicUserData;
  const name = displayName(member);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(clerkMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <Avatar name={name} size={28} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-ink">
          {name}
          {isSelf ? <span className="ml-1 font-normal text-ink-3">(you)</span> : null}
        </span>
        <span className="truncate text-2xs text-ink-3">{pub?.identifier}</span>
      </div>

      {/* Admins can change anyone's role except their own (avoid self-lockout);
          the last-admin guard is Clerk's — surfaced via the error line. */}
      {isAdmin && !isSelf ? (
        <Segmented
          value={member.role}
          onChange={(v) => run(() => onChangeRole(v as OrgRole), 'Could not change the role.')}
          options={[
            { value: 'org:member', label: 'Member' },
            { value: 'org:admin', label: 'Admin' },
          ]}
        />
      ) : (
        <Badge tone={member.role === 'org:admin' ? 'accent' : 'neutral'}>
          {roleLabel(member.role)}
        </Badge>
      )}

      {isAdmin && !isSelf ? (
        <Button
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Remove ${name} from this workspace?`)) {
              void run(onRemove, 'Could not remove the member.');
            }
          }}
        >
          Remove
        </Button>
      ) : null}

      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}

function InviteRow({
  invitation,
  onRevoke,
}: {
  invitation: InvitationResource;
  onRevoke: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRevoke();
    } catch (e) {
      setError(clerkMessage(e, 'Could not revoke the invitation.'));
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-inset text-ink-3">
        <Mail className="size-[15px]" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm text-ink-2">{invitation.emailAddress}</span>
        <span className="text-2xs text-ink-3">Invited · {roleLabel(invitation.role)}</span>
      </div>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      <Button variant="ghost" size="sm" disabled={busy} onClick={revoke}>
        {busy ? 'Revoking…' : 'Revoke'}
      </Button>
    </div>
  );
}

function displayName(m: MembershipResource): string {
  const pub = m.publicUserData;
  const full = `${pub?.firstName ?? ''} ${pub?.lastName ?? ''}`.trim();
  return full || pub?.identifier || 'Unknown';
}

function roleLabel(role: string): string {
  return role === 'org:admin' ? 'Admin' : 'Member';
}

// Only gates the optimistic enable/submit; Clerk validates the address
// server-side. A loose `local@domain.tld` shape is enough to avoid firing the
// mutation on obvious non-emails.
function isEmailLike(value: string): boolean {
  return /.+@.+\..+/.test(value.trim());
}
