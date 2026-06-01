'use client';

import { MessageSquare } from 'lucide-react';

export function DiscussionButton({
  open,
  unreadCount,
  onClick,
}: {
  open: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  // When the panel is open the FAB hides — the close affordance is the panel's
  // own X.
  if (open) return null;

  const label = unreadCount > 0 ? `Open Discussion — ${unreadCount} unread` : 'Open Discussion';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="discussion-fab fixed bottom-5 left-5 z-40 inline-flex items-center justify-center h-11 w-11 rounded-full bg-primary text-on-primary shadow-card hover:bg-primary-hover transition-all active:scale-[0.97]"
    >
      <MessageSquare className="h-[18px] w-[18px]" strokeWidth={2} />
      {unreadCount > 0 ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-on-accent text-[10px] font-semibold inline-flex items-center justify-center ring-2 ring-canvas"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      ) : null}
    </button>
  );
}
