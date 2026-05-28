export const defaultWorkspaceId = 'wsp_default';

// Event ids are monotonic-by-sort-order, not random ULIDs — the cursor protocol
// in tempo_poll relies on lexicographic comparison to advance.
export function newEventId(sequence: number): string {
  return `evt_${sequence.toString().padStart(14, '0')}`;
}
