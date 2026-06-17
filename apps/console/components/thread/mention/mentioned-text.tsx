'use client';

import { useOrganization } from '@clerk/nextjs';
import type { Mention } from '@tempo/contracts';
import { Tooltip } from '@/components/ui/tooltip';

// Inline renderer: walks `text` and replaces each `@${mention.label}` with a
// coloured, focusable token wrapped in the existing Tooltip so hover/focus
// reveals a small card with name + email. Used by Discussion + Comment rows.
//
// ponytail: no rich-text re-render. We split on literal `@Label` substrings
// in document order; if a label happens to collide with literal user text
// the colour overlaps — harmless for v1.

export function MentionedText({
  text,
  mentions,
  className,
}: {
  text: string;
  mentions: Mention[] | null | undefined;
  className?: string;
}) {
  // One Clerk subscription per text block — every MentionToken below reads
  // its email out of this map, not its own hook.
  const { memberships } = useOrganization({ memberships: true });

  if (!mentions || mentions.length === 0) {
    return <span className={className}>{text}</span>;
  }

  // Sort by descending label length so "@Alice Chen" matches before "@Alice".
  const sorted = [...mentions].sort((a, b) => b.label.length - a.label.length);

  const parts: Array<{ kind: 'text'; value: string } | { kind: 'mention'; m: Mention }> = [
    { kind: 'text', value: text },
  ];
  for (const m of sorted) {
    const needle = `@${m.label}`;
    const next: typeof parts = [];
    for (const p of parts) {
      if (p.kind !== 'text' || !p.value.includes(needle)) {
        next.push(p);
        continue;
      }
      const split = p.value.split(needle);
      for (let i = 0; i < split.length; i++) {
        const piece = split[i];
        if (piece && piece.length > 0) next.push({ kind: 'text', value: piece });
        if (i < split.length - 1) next.push({ kind: 'mention', m });
      }
    }
    parts.splice(0, parts.length, ...next);
  }

  const emailOf = (id: string): string | null =>
    memberships?.data?.find((m) => m.publicUserData?.userId === id)?.publicUserData?.identifier ??
    null;

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable order within one render
          <span key={i}>{p.value}</span>
        ) : (
          <MentionToken key={i} mention={p.m} email={p.m.kind === 'user' ? emailOf(p.m.id) : null} />
        ),
      )}
    </span>
  );
}

function MentionToken({ mention, email }: { mention: Mention; email: string | null }) {
  const card =
    mention.kind === 'agent' ? (
      <div className="text-caption">
        <div className="font-semibold text-ink">Agent</div>
        <div className="text-ink-tertiary">Tempo planning Agent</div>
      </div>
    ) : (
      <div className="text-caption">
        <div className="font-semibold text-ink">{mention.label}</div>
        {email ? <div className="text-ink-tertiary">{email}</div> : null}
      </div>
    );
  return (
    <Tooltip content={card}>
      <button
        type="button"
        className="mention-token rounded-sm focus-visible:outline-none focus-visible:shadow-focus-soft"
      >
        @{mention.label}
      </button>
    </Tooltip>
  );
}
