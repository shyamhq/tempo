export const defaultWorkspaceId = 'wsp_default';
// 26-char `[A-Z0-9]` literal so it matches the `SpaceId` ULID regex used at the
// HTTP boundary; must stay byte-identical to the seed in migration 0006.
export const defaultSpaceId = 'spc_00000000000000000000DEFAUL';

// Event ids are monotonic-by-sort-order, not random ULIDs — the cursor protocol
// in tempo_poll relies on lexicographic comparison to advance.
export function newEventId(sequence: number): string {
  return `evt_${sequence.toString().padStart(14, '0')}`;
}
