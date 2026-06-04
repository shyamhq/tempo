export function EmptyHome({ hasSpaces }: { hasSpaces: boolean }) {
  return (
    <div className="min-h-[60dvh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div
          aria-hidden
          className="mx-auto mb-4 h-10 w-10 rotate-45 rounded-md border border-hairline bg-surface-2"
        />
        <h2 className="font-display text-xl font-semibold text-ink">
          {hasSpaces ? 'Pick a Space or Thread' : 'Create your first Space'}
        </h2>
        <p className="text-sm text-ink-subtle mt-1.5">
          {hasSpaces
            ? 'Spaces group related planning Threads. Open one from the sidebar to start, or open a Thread to view its Plan.'
            : 'Spaces group related planning Threads — one per project, area, or initiative. Use the + button in the sidebar to add one.'}
        </p>
      </div>
    </div>
  );
}
