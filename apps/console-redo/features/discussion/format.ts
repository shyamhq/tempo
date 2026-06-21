// Shared timestamp formatter for the Discussion rows — the message row head and
// the live question card both render the same monospace HH:MM from an ISO
// created_at. Lives at the feature root (like comments/comment-text.ts) so the
// sibling components import it without a component-to-component dependency.

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
