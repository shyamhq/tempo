'use client';

import { useOrganization, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Search, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type WorkspaceInvitation, type WorkspaceMember } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useWorkspaceSettings } from '@/store/workspace-settings';

export function MembersSection() {
  const qc = useQueryClient();
  const { user } = useUser();
  const { membership } = useOrganization();
  const isAdmin = membership?.role === 'org:admin';

  const { data: members = [] } = useQuery({
    queryKey: ['workspace', 'members'],
    queryFn: () => api.listMembers().then((r) => r.members),
  });
  const { data: invitations = [] } = useQuery({
    queryKey: ['workspace', 'invitations'],
    queryFn: () => api.listInvitations().then((r) => r.invitations),
    enabled: isAdmin,
  });

  const selectedMemberId = useWorkspaceSettings((s) => s.selectedMemberId);
  const selectMember = useWorkspaceSettings((s) => s.selectMember);

  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const lc = search.trim().toLowerCase();
  const filteredMembers = lc
    ? members.filter(
        (m) =>
          (m.first_name ?? '').toLowerCase().includes(lc) ||
          (m.last_name ?? '').toLowerCase().includes(lc) ||
          (m.email ?? '').toLowerCase().includes(lc),
      )
    : members;

  // Default selection: the first member with a resolved user_id. When the Dev
  // clicks a row the store carries an explicit id; until then we don't write
  // to the store from an effect — derive inline.
  const selected =
    members.find((m) => m.user_id === selectedMemberId) ??
    members.find((m) => m.user_id) ??
    null;

  return (
    <div className="flex h-full">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-hairline">
        <header className="px-5 pt-8 pb-3">
          <div className="flex items-center justify-between">
            <h2 className="text-heading-5 text-ink">Members</h2>
            {isAdmin ? (
              <Button size="sm" variant="primary" onClick={() => setInviteOpen(true)}>
                Invite
              </Button>
            ) : null}
          </div>
          <p className="mt-1 text-caption text-ink-subtle">
            {members.length} {members.length === 1 ? 'member' : 'members'}
            {invitations.length ? ` · ${invitations.length} pending` : ''}
          </p>
          <label className="mt-4 flex h-8 items-center gap-2 rounded-md border border-hairline bg-canvas px-2.5 text-ink-tertiary">
            <Search className="h-3.5 w-3.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter members…"
              className="flex-1 border-none bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
            />
          </label>
        </header>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {filteredMembers.map((m) => (
            <MemberRow
              key={m.user_id ?? m.email}
              member={m}
              isSelf={user?.id === m.user_id}
              active={selected?.user_id === m.user_id}
              onSelect={() => m.user_id && selectMember(m.user_id)}
            />
          ))}

          {isAdmin && invitations.length > 0 ? (
            <>
              <div className="px-2 pt-4 pb-1.5 text-micro-uppercase uppercase text-ink-tertiary">
                Pending
              </div>
              {invitations.map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} />
              ))}
            </>
          ) : null}
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <MemberDetail
            member={selected}
            isAdmin={isAdmin}
            isSelf={user?.id === selected.user_id}
          />
        ) : (
          <div className="grid h-full place-items-center text-caption text-ink-tertiary">
            Select a member to view their profile.
          </div>
        )}
      </div>

      {inviteOpen ? <InviteDialog onClose={() => setInviteOpen(false)} /> : null}
    </div>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');

  const invite = useMutation({
    mutationFn: () => api.createInvitation({ email, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace', 'invitations'] });
      onClose();
    },
  });

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-overlay backdrop-blur-sm">
      <div className="w-[420px] rounded-xl border border-hairline bg-canvas p-5 shadow-card-elevated">
        <h3 className="text-heading-5 text-ink">Invite to workspace</h3>
        <p className="mt-1 text-caption text-ink-subtle">We'll email them an invitation link.</p>
        <label
          htmlFor="invite-email"
          className="mt-4 block text-caption font-medium text-ink-muted"
        >
          Email
        </label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          className="mt-1.5"
        />
        <div className="mt-4 block text-caption font-medium text-ink-muted">Role</div>
        <div className="mt-1.5 flex gap-2">
          {(['member', 'admin'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={cn(
                'flex-1 rounded-md border px-3 py-2 text-caption font-medium transition',
                role === r
                  ? 'border-ink bg-ink text-on-primary'
                  : 'border-hairline text-ink-muted hover:bg-surface-2',
              )}
            >
              {r === 'admin' ? 'Admin' : 'Member'}
            </button>
          ))}
        </div>
        <footer className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => invite.mutate()}
            disabled={!email.includes('@') || invite.isPending}
          >
            {invite.isPending ? 'Sending…' : 'Send invite'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  active,
  onSelect,
}: {
  member: WorkspaceMember;
  isSelf: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition',
        active ? 'bg-surface-3' : 'hover:bg-surface-2',
      )}
    >
      <UserAvatar member={member} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-caption-bold text-ink">
          {displayName(member)}
          {isSelf ? <span className="ml-1 text-ink-tertiary font-normal">(you)</span> : null}
        </span>
        <span className="truncate text-micro text-ink-tertiary">{member.email}</span>
      </span>
      <RolePill role={member.role} />
    </button>
  );
}

function InvitationRow({ invitation }: { invitation: WorkspaceInvitation }) {
  const qc = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => api.revokeInvitation(invitation.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', 'invitations'] }),
  });
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-tertiary">
        <Mail className="h-3.5 w-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-caption text-ink-muted">{invitation.email}</span>
        <span className="truncate text-micro text-ink-tertiary">Invited</span>
      </span>
      <button
        type="button"
        onClick={() => revoke.mutate()}
        disabled={revoke.isPending}
        className="text-micro font-medium text-ink-tertiary hover:text-danger"
      >
        Revoke
      </button>
    </div>
  );
}

function MemberDetail({
  member,
  isAdmin,
  isSelf,
}: {
  member: WorkspaceMember;
  isAdmin: boolean;
  isSelf: boolean;
}) {
  const qc = useQueryClient();
  const selectMember = useWorkspaceSettings((s) => s.selectMember);

  const updateRole = useMutation({
    mutationFn: (next: 'admin' | 'member') => api.updateMemberRole(member.user_id as string, next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', 'members'] }),
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Could not update role.';
      if (msg.includes('last_admin')) {
        window.alert("You can't demote the last admin.");
      } else {
        window.alert(msg);
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => api.removeMember(member.user_id as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace', 'members'] });
      selectMember(null);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Could not remove member.';
      if (msg.includes('last_admin')) {
        window.alert("You can't remove the last admin.");
      } else {
        window.alert(msg);
      }
    },
  });

  const canChangeRole = isAdmin && !isSelf;
  const canRemove = isAdmin || isSelf;

  return (
    <div className="px-10 pt-8 pb-12">
      <header className="flex items-start gap-4">
        <UserAvatar member={member} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-heading-5 text-ink">{displayName(member)}</h2>
          <p className="text-caption text-ink-subtle">{member.email}</p>
          <p className="mt-1 text-micro text-ink-tertiary">
            Joined {new Date(member.created_at).toLocaleDateString()}
          </p>
        </div>
      </header>

      <dl className="mt-8 border-t border-hairline">
        <Row label="Role">
          {canChangeRole ? (
            <select
              value={member.role}
              onChange={(e) => updateRole.mutate(e.target.value as 'admin' | 'member')}
              disabled={updateRole.isPending}
              className="h-8 rounded-md border border-hairline bg-surface-2 px-3 text-caption text-ink outline-none focus-visible:border-accent-focus"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          ) : (
            <RolePill role={member.role} />
          )}
        </Row>
        <Row label="Status">
          <span className="text-caption text-ink-muted">Active</span>
        </Row>
      </dl>

      {canRemove ? (
        <footer className="mt-10 flex justify-end border-t border-hairline pt-6">
          <Button
            variant="danger"
            onClick={() => {
              const ok = window.confirm(
                isSelf
                  ? 'Leave this workspace?'
                  : `Remove ${displayName(member)} from this workspace?`,
              );
              if (ok) remove.mutate();
            }}
            disabled={remove.isPending}
          >
            <UserMinus className="h-3.5 w-3.5" /> {isSelf ? 'Leave workspace' : 'Remove member'}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline-soft py-4">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RolePill({ role }: { role: 'admin' | 'member' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2.5 text-micro font-medium',
        role === 'admin' ? 'bg-accent/15 text-accent-deep' : 'bg-surface-3 text-ink-muted',
      )}
    >
      {role === 'admin' ? 'Admin' : 'Member'}
    </span>
  );
}

function UserAvatar({ member, size = 'sm' }: { member: WorkspaceMember; size?: 'sm' | 'lg' }) {
  const dim = size === 'lg' ? 'h-14 w-14 text-heading-5' : 'h-7 w-7 text-caption-bold';
  if (member.image_url) {
    return (
      <img
        alt={displayName(member)}
        src={member.image_url}
        className={cn('shrink-0 rounded-full object-cover', dim)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-semibold text-ink-muted',
        dim,
      )}
    >
      {initials(member)}
    </span>
  );
}

function displayName(m: WorkspaceMember): string {
  const fullName = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim();
  return fullName || m.email || 'Unknown';
}

function initials(m: WorkspaceMember): string {
  if (m.first_name || m.last_name) {
    return `${(m.first_name ?? '')[0] ?? ''}${(m.last_name ?? '')[0] ?? ''}`.toUpperCase();
  }
  return (m.email ?? 'U')[0]?.toUpperCase() ?? 'U';
}
