'use client';

// The three-zone Workbench shell (T3.1): a CSS-grid frame with the left nav rail,
// the routed center outlet, and the right dockable panel. Borders define the zone
// seams — no shadows. Rail/dock visibility is the ui slice's railOpen / dockOpen;
// the columns collapse to zero width when closed so the outlet reclaims the room.
//
// The right panel is an empty placeholder now — Phase 5 fills it with the
// discussion / agent-activity views. The (app) group sits under Clerk auth
// (proxy.ts protects everything outside /sign-in and /sign-up).

import { PanelLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Sidebar } from '@/features/sidebar/components/sidebar';
import { useSidebarHydration } from '@/hooks/useSidebarHydration';
import { useDockOpen, useRailOpen, useThreadStore } from '@/store';

export default function AppLayout({ children }: { children: ReactNode }) {
  const railOpen = useRailOpen();
  const dockOpen = useDockOpen();

  useSidebarHydration();

  return (
    <div
      className="grid h-dvh w-full overflow-hidden bg-bg"
      style={{
        gridTemplateColumns: `${railOpen ? '230px' : '0px'} minmax(0, 1fr) ${dockOpen ? '380px' : '0px'}`,
      }}
    >
      <aside className="min-w-0 overflow-hidden border-r border-border bg-sidebar">
        {railOpen ? <Sidebar /> : null}
      </aside>

      <main className="relative min-w-0 overflow-y-auto bg-bg">
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

      <aside className="min-w-0 overflow-hidden border-l border-border bg-panel">
        {/* Phase 5 fills this — discussion / agent activity. Empty for now. */}
      </aside>
    </div>
  );
}
