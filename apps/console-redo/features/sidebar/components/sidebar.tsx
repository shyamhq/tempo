'use client';

// The left rail: workspace switcher, thread search, and the spaces/threads tree.
// Fully presentational over the sidebar slice — it reads spaces via selectors and
// triggers create/rename/delete through slice actions. The tree itself is seeded
// once on shell mount by useSidebarHydration (called in the (app) layout).

import { PanelLeftClose, Plus, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useSidebarSpaces, useThreadStatus, useThreadStore } from '@/store';
import { SpaceRow } from './space-row';
import { WorkspaceSwitcher } from './workspace-switcher';

export function Sidebar() {
  const pathname = usePathname();
  const activeThreadId = pathname?.startsWith('/t/') ? pathname.split('/')[2] : undefined;

  const spaces = useSidebarSpaces();
  const { agentPresent } = useThreadStatus();

  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return spaces;
    return spaces.filter((s) => s.name.toLowerCase().includes(q));
  }, [spaces, search]);

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-2 pt-1.5 pb-1">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher />
        </div>
        <button
          type="button"
          title="Collapse sidebar"
          onClick={() => useThreadStore.getState().toggleRail()}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 outline-none transition-colors hover:bg-inset hover:text-ink focus-visible:shadow-[var(--tp-focus-ring)]"
        >
          <PanelLeftClose className="size-[15px]" strokeWidth={2} />
        </button>
      </div>

      <div className="px-3 pb-2">
        <Input
          size="sm"
          icon={<Search />}
          placeholder="Search spaces…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between px-[14px] py-1.5">
        <span className="text-2xs font-semibold uppercase tracking-label text-ink-3">Spaces</span>
        <button
          type="button"
          onClick={() => void useThreadStore.getState().createSpace()}
          className="flex items-center gap-1.5 text-sm font-medium text-success hover:opacity-80"
        >
          <Plus className="size-[13px]" strokeWidth={2.2} /> New
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {filtered.map((s) => (
          <SpaceRow
            key={s.id}
            space={s}
            spaces={spaces}
            activeThreadId={activeThreadId}
            agentPresent={agentPresent}
          />
        ))}
        {filtered.length === 0 ? (
          <div className="px-4 py-2 text-sm text-ink-3">
            {search ? 'No matches.' : 'No spaces yet.'}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
