// Next.js boot hook — runs once per server instance. Wires the shared
// Mailbox writer into appendEvent so Console-side calls (status_changed
// from approve/reopen) also enqueue Hosted wake-ups.
//
// No isFresh guard here — Console can't see Worker's in-process presence.
// Task 2.7's supervisor re-checks isFresh before provisioning a VM, so
// over-enqueue is a no-op there.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { setAfterAppendHook, enqueueMailboxIfHosted } = await import('@tempo/server');
  setAfterAppendHook(enqueueMailboxIfHosted);
}
