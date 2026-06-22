'use client';

// The workspace-settings modal: a centered Radix Dialog with a left-rail section
// nav and a right content area that switches on the active section. The open flag
// + section live in the UI slice (transient, not persisted); the workspace
// switcher's "Workspace settings" item opens it.
//
// Mounted once in app/(app)/layout.tsx — it's workspace-scoped, so it's available
// on every (app) route (dashboard + threads) from a single mount point.
//
// No forceMount: Radix unmounts both surfaces on close. forceMount would leave a
// stale inset-0 overlay in the DOM whose Radix-set inline pointer-events:auto (a
// class can't override inline style) swallows every page click. Entry is a mount
// animation (the dialog only exists while open) — see activity-drawer.tsx.

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Plug, Settings, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsOpen, useSettingsSection, useThreadStore } from '@/store';
import type { SettingsSection } from '@/store/ui';
import { ConnectorsSection } from './sections/connectors';
import { DangerZoneSection } from './sections/danger-zone';
import { GeneralSection } from './sections/general';
import { MembersSection } from './sections/members';

type NavItem = {
  key: SettingsSection;
  label: string;
  icon: typeof Settings;
  tone?: 'danger';
};

const NAV: NavItem[] = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'members', label: 'Members', icon: Users },
  { key: 'connectors', label: 'Connectors', icon: Plug },
  { key: 'danger', label: 'Danger zone', icon: AlertTriangle, tone: 'danger' },
];

export function SettingsModal() {
  const open = useSettingsOpen();
  const section = useSettingsSection();
  const setOpen = useThreadStore((s) => s.setSettingsOpen);
  const setSection = useThreadStore((s) => s.setSettingsSection);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="tp-fade-in fixed inset-0 z-[70] bg-[var(--tp-backdrop)]" />
        {/* The base -translate keeps the modal centered after tp-scale-in ends
            (CSS animations don't persist their final transform) and when the
            animation is disabled under prefers-reduced-motion. The keyframe also
            carries the same translate so centering holds during the animation. */}
        <Dialog.Content className="tp-scale-in fixed left-1/2 top-1/2 z-[71] flex h-[80vh] max-h-[680px] w-[1000px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-canvas shadow-lg outline-none">
          <Dialog.Title className="sr-only">Workspace settings</Dialog.Title>
          <Dialog.Description className="sr-only">
            Manage your workspace name, agent key, members, connectors, and danger-zone actions.
          </Dialog.Description>

          <SettingsRail section={section} onChange={setSection} />

          <div className="relative min-w-0 flex-1 overflow-y-auto bg-bg">
            <Dialog.Close
              aria-label="Close settings"
              className="absolute right-4 top-4 z-10 inline-flex size-7 items-center justify-center rounded-sm text-ink-2 outline-none transition-colors hover:bg-inset hover:text-ink focus-visible:shadow-[var(--tp-focus-ring)] [&_svg]:size-4"
            >
              <X aria-hidden />
            </Dialog.Close>
            <SectionRouter section={section} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingsRail({
  section,
  onChange,
}: {
  section: SettingsSection;
  onChange: (s: SettingsSection) => void;
}) {
  return (
    <aside className="flex w-[210px] shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-2.5 pt-4">
      <div className="px-2 pb-1.5 text-2xs font-semibold uppercase tracking-label text-ink-3">
        Workspace
      </div>
      {NAV.map((item) => (
        <RailItem
          key={item.key}
          item={item}
          active={section === item.key}
          onSelect={() => onChange(item.key)}
        />
      ))}
    </aside>
  );
}

function RailItem({
  item,
  active,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 rounded-[7px] px-[9px] py-[7px] text-left text-sm font-medium outline-none transition-colors focus-visible:shadow-[var(--tp-focus-ring)]',
        active
          ? 'bg-primary-soft text-primary'
          : item.tone === 'danger'
            ? 'text-danger hover:bg-danger-bg'
            : 'text-ink-2 hover:bg-inset hover:text-ink',
      )}
    >
      <Icon className="size-[15px] shrink-0" strokeWidth={2} />
      {item.label}
    </button>
  );
}

function SectionRouter({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'general':
      return <GeneralSection />;
    case 'members':
      return <MembersSection />;
    case 'connectors':
      return <ConnectorsSection />;
    case 'danger':
      return <DangerZoneSection />;
    default:
      // Exhaustive: a new SettingsSection must add a case here or fail typecheck,
      // not silently render nothing.
      section satisfies never;
      return null;
  }
}
