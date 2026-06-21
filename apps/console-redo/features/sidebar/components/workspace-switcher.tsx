'use client';

// The rail's workspace switcher. An org IS the workspace (1:1), so this reads
// Clerk's org state DIRECTLY — useOrganization for the active org, and
// useOrganizationList for the membership list + setActive. No hand-rolled
// workspace endpoint: the data is already client-side from Clerk.

import { useClerk, useOrganization, useOrganizationList, useUser } from '@clerk/nextjs';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, LogOut, Plus, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useThreadStore } from '@/store';

// Narrow view of a Clerk OrganizationMembership — only the fields this file
// renders. `imageUrl` matches Clerk's actual return shape: a string when the org
// has an avatar, null/undefined otherwise.
type OrgView = {
  id: string;
  name: string;
  imageUrl: string | null | undefined;
  membersCount: number;
};
type Membership = { id: string; role: string; organization: OrgView };

export function WorkspaceSwitcher() {
  const { user } = useUser();
  const clerk = useClerk();
  const router = useRouter();
  const setSettingsOpen = useThreadStore((s) => s.setSettingsOpen);
  const { organization: activeOrg } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const memberships = (userMemberships?.data ?? []) as Membership[];

  // The membership for the active org. No fallback to memberships[0]: showing a
  // workspace other than the one in session would be a silent lie (onboarding
  // guarantees an active org before the app shell renders).
  const display = memberships.find((m) => m.organization.id === activeOrg?.id);

  const switchTo = async (orgId: string) => {
    if (!setActive) return;
    await setActive({ organization: orgId });
    // Org is the workspace; switching it changes all sidebar data. Remount the
    // (app) layout so useSidebarHydration re-seeds for the new workspace.
    router.refresh();
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2.5 text-left outline-none transition-colors hover:border-border hover:bg-inset data-[state=open]:bg-inset focus-visible:shadow-[var(--tp-focus-ring)]"
        >
          <OrgAvatar org={display?.organization} size={28} />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-display text-base font-semibold text-ink">
              {display?.organization.name ?? ''}
            </span>
            <span className="truncate text-xs text-ink-3">
              {display
                ? `${roleLabel(display.role)} · ${memberLabel(display.organization.membersCount)}`
                : ''}
            </span>
          </span>
          <ChevronDown className="size-[15px] shrink-0 text-ink-3" strokeWidth={2.2} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[260px] rounded-xl border border-border bg-canvas p-1.5 shadow-[var(--tp-shadow-lg)] outline-none"
        >
          <div className="border-b border-border px-2.5 pb-2 pt-1.5">
            <div className="truncate text-xs text-ink-3">
              {user?.primaryEmailAddress?.emailAddress ?? ''}
            </div>
          </div>

          <div className="px-1.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-label text-ink-3">
            Workspaces
          </div>
          <div className="flex flex-col">
            {memberships.map((m) => {
              const active = activeOrg?.id === m.organization.id;
              return (
                <DropdownMenu.Item
                  key={m.id}
                  onSelect={() => !active && void switchTo(m.organization.id)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-inset"
                >
                  <OrgAvatar org={m.organization} size={24} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-semibold text-ink">
                      {m.organization.name}
                    </span>
                    <span className="truncate text-2xs text-ink-3">
                      {roleLabel(m.role)} · {memberLabel(m.organization.membersCount)}
                    </span>
                  </span>
                  {active ? <Check className="size-[15px] shrink-0 text-primary" /> : null}
                </DropdownMenu.Item>
              );
            })}
          </div>

          <Separator />
          <ActionItem
            icon={Settings}
            label="Workspace settings"
            onSelect={() => setSettingsOpen(true)}
          />
          <ActionItem
            icon={Plus}
            label="Create workspace"
            onSelect={() => clerk.openCreateOrganization?.()}
          />
          <Separator />
          <ActionItem
            icon={LogOut}
            label="Sign out"
            onSelect={() => clerk.signOut({ redirectUrl: '/sign-in' })}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ActionItem({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: typeof Plus;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink-2 outline-none data-[highlighted]:bg-inset data-[highlighted]:text-ink"
    >
      <Icon className="size-[15px] text-ink-3" strokeWidth={2} />
      {label}
    </DropdownMenu.Item>
  );
}

function Separator() {
  return <div className="my-1 h-px bg-border" />;
}

function OrgAvatar({
  org,
  size,
}: {
  org: Pick<OrgView, 'name' | 'imageUrl'> | undefined;
  size: number;
}) {
  if (org?.imageUrl) {
    return (
      <img
        alt={org.name}
        src={org.imageUrl}
        className="shrink-0 rounded-sm object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-sm bg-ink font-bold text-bg"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
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
