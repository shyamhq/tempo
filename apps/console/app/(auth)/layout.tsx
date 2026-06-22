import type { ReactNode } from 'react';

// Centered layout for signed-out surfaces (sign-in, sign-up). No app shell —
// these routes run before the user is signed in.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center bg-bg px-4">{children}</main>;
}
