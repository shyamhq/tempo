// Event ids are monotonic-by-sort-order, not random ULIDs — the cursor protocol
// in tempo_poll relies on lexicographic comparison to advance.
//
// Accepts a string so callers holding a bigint-as-string (pg returns bigint
// that way) can pass it through without a precision-losing Number() round-trip.
export function newEventId(sequence: number | string): string {
  const s = typeof sequence === 'string' ? sequence : sequence.toString();
  return `evt_${s.padStart(14, '0')}`;
}
