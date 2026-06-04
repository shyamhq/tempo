const PALETTE = ['#0BBF8E', '#3772CF', '#C98A2B', '#E5484D', '#7C5CFF'] as const;

export function colorForSpace(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
