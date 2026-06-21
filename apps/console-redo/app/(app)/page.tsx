// The center-zone empty state: shown until a Space or Thread is opened from the
// rail. A Thread route (/t/[threadId]) replaces this in Phase 4.

export default function DashboardPage() {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <p className="font-display text-lg font-semibold text-ink">Pick a Space or Thread</p>
        <p className="text-base text-ink-2">
          Choose a Thread from the rail to open its plan, or start a new one.
        </p>
      </div>
    </div>
  );
}
