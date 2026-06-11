'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CreditCard, Settings, Sparkles, Users, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { type SettingsSection, useWorkspaceSettings } from '@/store/workspace-settings';
import { BillingSection } from './sections/billing';
import { DangerZoneSection } from './sections/danger-zone';
import { GeneralSection } from './sections/general';
import { IntegrationsSection } from './sections/integrations';
import { MembersSection } from './sections/members';

type NavItem = {
  key: SettingsSection;
  label: string;
  icon: typeof Settings;
  group: 'workspace' | 'account';
  tone?: 'danger';
};

const NAV: NavItem[] = [
  { key: 'general', label: 'General', icon: Settings, group: 'workspace' },
  { key: 'members', label: 'Members', icon: Users, group: 'workspace' },
  { key: 'billing', label: 'Billing', icon: CreditCard, group: 'workspace' },
  { key: 'integrations', label: 'Integrations', icon: Sparkles, group: 'workspace' },
  { key: 'danger', label: 'Danger zone', icon: AlertTriangle, group: 'account', tone: 'danger' },
];

export function SettingsModal() {
  const open = useWorkspaceSettings((s) => s.open);
  const section = useWorkspaceSettings((s) => s.section);
  const setSection = useWorkspaceSettings((s) => s.setSection);
  const closeModal = useWorkspaceSettings((s) => s.closeModal);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? null : closeModal())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex h-[86vh] w-[88vw] max-w-[1440px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-hairline bg-canvas shadow-card-elevated outline-none"
        >
          <Dialog.Title className="sr-only">Workspace settings</Dialog.Title>

          <SettingsRail section={section} onChange={setSection} />

          <div className="relative flex-1 overflow-y-auto">
            <Dialog.Close
              aria-label="Close settings"
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-4 w-4" />
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
    <aside className="flex w-[230px] shrink-0 flex-col border-r border-hairline bg-surface-2/40 px-3 pt-6 pb-4">
      <RailGroup label="Workspace">
        {NAV.filter((n) => n.group === 'workspace').map((n) => (
          <RailItem key={n.key} item={n} active={section === n.key} onSelect={onChange} />
        ))}
      </RailGroup>
      <RailGroup label="Account">
        {NAV.filter((n) => n.group === 'account').map((n) => (
          <RailItem key={n.key} item={n} active={section === n.key} onSelect={onChange} />
        ))}
      </RailGroup>
    </aside>
  );
}

function RailGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2">
      <div className="px-2.5 pt-3 pb-1.5 text-micro-uppercase uppercase text-ink-tertiary">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function RailItem({
  item,
  active,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  onSelect: (s: SettingsSection) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.key)}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-caption transition outline-none focus-visible:shadow-focus-soft',
        active
          ? 'bg-primary text-on-primary'
          : item.tone === 'danger'
            ? 'text-danger hover:bg-danger-soft'
            : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
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
    case 'billing':
      return <BillingSection />;
    case 'integrations':
      return <IntegrationsSection />;
    case 'danger':
      return <DangerZoneSection />;
  }
}

export function SectionFrame({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="px-10 pt-8 pb-12">
      <header className="mb-6">
        <h2 className="text-heading-5 text-ink">{title}</h2>
        {description ? <p className="mt-1 text-caption text-ink-subtle">{description}</p> : null}
      </header>
      {children}
    </div>
  );
}
