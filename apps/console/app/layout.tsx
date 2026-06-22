import { ClerkProvider } from '@clerk/nextjs';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata = {
  title: 'Tempo',
  description: 'Planning Threads for engineers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes writes data-theme on <html> before
    // React hydrates, so the server-rendered attribute and the client's differ
    // by design — this scopes the warning to the one element it owns.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh">
        {/* globals.css keys dark mode off [data-theme="dark"]; our theme names
            (light/dark) are the DOM attribute values verbatim, so no value map. */}
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
          <ClerkProvider>{children}</ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
