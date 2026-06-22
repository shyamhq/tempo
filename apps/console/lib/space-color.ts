// Deterministic badge colour for a space, hashed from its id so the same space
// always reads the same tint across reloads. Mirrors apps/console/lib/space-color.ts.

const PALETTE = ['#0BBF8E', '#3772CF', '#C98A2B', '#E5484D', '#7C5CFF'] as const;

export function colorForSpace(id: string): (typeof PALETTE)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? PALETTE[0];
}
