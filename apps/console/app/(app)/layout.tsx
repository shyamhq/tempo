import type { ReactNode } from 'react';
import { Sidebar } from '@/components/sidebar/sidebar';
import { SettingsModal } from '@/components/workspace/settings-modal';
import { currentWorkspaceId } from '@/server/actor';
import { listSpaces } from '@/server/spaces';

// This layout owns the authenticated app shell: sidebar, content area,
// settings modal. Mounting it under the `(app)` route group means it never
// wraps `/sign-in`, `/sign-up`, or `/onboarding` — those live under `(auth)`
// with their own minimal layout. Middleware (`proxy.ts`) guarantees a signed-in
// user with an active org by the time anything here renders, so the workspace
// reads below cannot meaningfully fail.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const spaces = await listSpaces(await currentWorkspaceId());
  return (
    <>
      <div className="flex h-dvh">
        <Sidebar initial={spaces} />
        <div className="flex-1 min-w-0 overflow-auto">{children}</div>
      </div>
      <SettingsModal />
    </>
  );
}
