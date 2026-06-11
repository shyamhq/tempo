'use client';

import { useClerk, useOrganization, useOrganizationList, useUser } from '@clerk/nextjs';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, LogOut, Plus, Settings, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useWorkspaceSettings } from '@/store/workspace-settings';

// Narrow view of a Clerk OrganizationMembership — only the fields this file
// renders. Avoids pulling `@clerk/types` (a peer of `@clerk/nextjs`, not a
// direct dep) for a handful of properties. `imageUrl` matches Clerk's actual
// return shape: present for orgs with an avatar, null/undefined otherwise.
type OrgView = {
  id: string;
  name: string;
  imageUrl: string | null | undefined;
  membersCount: number;
};
type Membership = { id: string; role: string; organization: OrgView };

export function WorkspaceSwitcher({
  collapsed = false,
  onOpenChange,
}: {
  collapsed?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { user } = useUser();
  const clerk = useClerk();
  const router = useRouter();
  const qc = useQueryClient();
  const openModal = useWorkspaceSettings((s) => s.openModal);

  const { organization: activeOrg } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const memberships = (userMemberships?.data ?? []) as Membership[];

  // Display the active membership when one is pinned; fall back to the first
  // membership only if Clerk hasn't reported an active org yet (rare — the
  // middleware in proxy.ts redirects to /onboarding when orgId is null, and
  // onboarding pins one). Either way, no server fetch is involved.
  const display = memberships.find((m) => m.organization.id === activeOrg?.id) ?? memberships[0];

  const switchTo = async (orgId: string) => {
    if (!setActive) return;
    try {
      await setActive({ organization: orgId });
      await qc.invalidateQueries();
      router.refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not switch workspace.');
    }
  };

  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        {collapsed ? (
          <button
            type="button"
            aria-label="Switch workspace"
            className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-caption font-bold text-on-primary outline-none focus-visible:shadow-focus-soft"
          >
            <OrgAvatar org={display?.organization} size="sm" />
          </button>
        ) : (
          <button
            type="button"
            className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition hover:bg-surface-2 data-[state=open]:bg-surface-2 focus-visible:shadow-focus-soft"
          >
            <OrgAvatar org={display?.organization} size="md" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-body-sm-medium text-ink">
                {display?.organization.name ?? ''}
              </span>
              <span className="truncate text-micro text-ink-tertiary">
                {display
                  ? `${roleLabel(display.role)} · ${memberLabel(display.organization.membersCount)}`
                  : ''}
              </span>
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 text-ink-subtle opacity-0 transition group-hover:opacity-100 group-data-[state=open]:opacity-100"
              strokeWidth={2.2}
            />
          </button>
        )}
      </DropdownMenu.Trigger>
      <Popover
        side={collapsed ? 'right' : 'bottom'}
        activeOrgId={activeOrg?.id ?? null}
        memberships={memberships}
        userEmail={user?.primaryEmailAddress?.emailAddress ?? ''}
        switchTo={switchTo}
        openSettings={() => openModal('general')}
        openMembers={() => openModal('members')}
        signOut={() => clerk.signOut({ redirectUrl: '/sign-in' })}
        openCreate={() => clerk.openCreateOrganization?.()}
      />
    </DropdownMenu.Root>
  );
}

function Popover({
  side,
  activeOrgId,
  memberships,
  userEmail,
  switchTo,
  openSettings,
  openMembers,
  signOut,
  openCreate,
}: {
  side: 'right' | 'bottom';
  activeOrgId: string | null;
  memberships: Membership[];
  userEmail: string;
  switchTo: (orgId: string) => Promise<void>;
  openSettings: () => void;
  openMembers: () => void;
  signOut: () => void;
  openCreate: () => void;
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        side={side}
        align="start"
        sideOffset={6}
        className="z-50 w-[280px] rounded-xl border border-hairline bg-canvas p-1.5 shadow-compose outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out"
      >
        <div className="border-b border-hairline-soft px-2.5 pb-2 pt-1.5">
          <div className="truncate text-micro text-ink-tertiary">{userEmail}</div>
        </div>

        <div className="px-1.5 pb-1 pt-2 text-micro-uppercase uppercase text-ink-tertiary">
          Workspaces
        </div>
        <div className="flex flex-col">
          {memberships.map((m) => {
            const active = activeOrgId === m.organization.id;
            return (
              <DropdownMenu.Item
                key={m.id}
                onSelect={() => !active && void switchTo(m.organization.id)}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2"
              >
                <OrgAvatar org={m.organization} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-caption-bold text-ink">{m.organization.name}</span>
                  <span className="truncate text-micro text-ink-tertiary">
                    {roleLabel(m.role)} · {memberLabel(m.organization.membersCount)}
                  </span>
                </span>
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-accent-deep" /> : null}
              </DropdownMenu.Item>
            );
          })}
        </div>

        <Separator />
        <ActionItem icon={Settings} label="Workspace settings" onSelect={openSettings} />
        <ActionItem icon={UserPlus} label="Invite people" onSelect={openMembers} />
        <ActionItem icon={Plus} label="Create workspace" onSelect={openCreate} />
        <Separator />
        <ActionItem icon={LogOut} label="Sign out" onSelect={signOut} />
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

function ActionItem({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: typeof Settings;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-caption text-ink-muted outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink"
    >
      <Icon className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={2} />
      {label}
    </DropdownMenu.Item>
  );
}

function Separator() {
  return <div className="my-1 h-px bg-hairline-soft" />;
}

function OrgAvatar({
  org,
  size,
}: {
  org: Pick<OrgView, 'name' | 'imageUrl'> | undefined;
  size: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-6 w-6 text-micro' : 'h-7 w-7 text-caption-bold';
  if (org?.imageUrl) {
    return (
      <img
        alt={org.name}
        src={org.imageUrl}
        className={cn('shrink-0 rounded-sm object-cover', dim)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-sm bg-ink font-bold text-on-primary',
        dim,
      )}
    >
      {(org?.name ?? 'W')[0]?.toUpperCase()}
    </span>
  );
}

function roleLabel(role: string): string {
  return role === 'org:admin' ? 'Admin' : 'Member';
}

function memberLabel(n: number): string {
  return n === 1 ? '1 member' : `${n} members`;
}
