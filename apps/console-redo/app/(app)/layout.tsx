'use client';

// The Workbench shell (T3.1, refined in T5.1): a two-column CSS-grid frame — the
// left nav rail and the routed center outlet. Borders define the zone seam — no
// shadows. The rail collapses to zero width when closed so the outlet reclaims
// the room.
//
// The discussion dock is thread-scoped (it lives inside ThreadView, not here), so
// non-thread routes (dashboard) correctly have no dock. The (app) group sits
// under Clerk auth (proxy.ts protects everything outside /sign-in and /sign-up).

import { PanelLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Sidebar } from '@/features/sidebar/components/sidebar';
import { useSidebarHydration } from '@/hooks/useSidebarHydration';
import { useRailOpen, useThreadStore } from '@/store';

export default function AppLayout({ children }: { children: ReactNode }) {
  const railOpen = useRailOpen();

  useSidebarHydration();

  return (
    <div
      className="grid h-dvh w-full overflow-hidden bg-bg"
      style={{ gridTemplateColumns: `${railOpen ? '230px' : '0px'} minmax(0, 1fr)` }}
    >
      <aside className="min-w-0 overflow-hidden border-r border-border bg-sidebar">
        {railOpen ? <Sidebar /> : null}
      </aside>

      <main className="relative min-w-0 overflow-hidden bg-bg">
        {railOpen ? null : (
          <button
            type="button"
            title="Open sidebar"
            onClick={() => useThreadStore.getState().setRailOpen(true)}
            className="absolute left-2 top-2 z-10 flex size-7 items-center justify-center rounded-md border border-border bg-canvas text-ink-3 outline-none transition-colors hover:bg-inset hover:text-ink focus-visible:shadow-[var(--tp-focus-ring)]"
          >
            <PanelLeft className="size-[15px]" strokeWidth={2} />
          </button>
        )}
        {children}
      </main>
    </div>
  );
}
