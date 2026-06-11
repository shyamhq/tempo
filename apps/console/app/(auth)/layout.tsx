import type { ReactNode } from 'react';

// Minimal centered layout for pre-app surfaces: sign-in, sign-up, onboarding.
// No sidebar, no workspace data — these routes either run before the user has
// an org pinned or before the user is signed in at all.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      {children}
    </main>
  );
}
