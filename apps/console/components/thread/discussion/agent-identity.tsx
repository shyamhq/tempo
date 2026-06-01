export function AgentIdentity({ created_at }: { created_at: string }) {
  const timeLabel = new Date(created_at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-accent-deep">
        <span aria-hidden className="size-[5px] rounded-full bg-current" />
        Agent
      </span>
      <span aria-hidden className="text-[11px] text-ink-tertiary tabular-nums">
        ·
      </span>
      <time dateTime={created_at} className="text-[11px] text-ink-tertiary tabular-nums">
        {timeLabel}
      </time>
    </div>
  );
}
