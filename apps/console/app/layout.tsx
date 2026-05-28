import type { ReactNode } from 'react';

export const metadata = {
  title: 'Tempo',
  description: 'Planning Threads for engineers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
