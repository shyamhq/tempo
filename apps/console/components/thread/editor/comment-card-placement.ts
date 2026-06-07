export const COMMENT_CARD_VIEWPORT = {
  gap: 8,
  padding: 12,
  /** Sticky thread header (`h-14`). */
  header: 56,
} as const;

/** Pick above/below from available space, then clamp inside the viewport. */
export function resolveVerticalCardTop(
  anchorTop: number,
  cardHeight: number,
  viewportHeight = window.innerHeight,
): number {
  const { gap, padding, header } = COMMENT_CARD_VIEWPORT;
  const spaceBelow = viewportHeight - anchorTop - padding;
  const spaceAbove = anchorTop - header - padding;
  const openAbove = spaceBelow < cardHeight && spaceAbove >= spaceBelow;
  const naturalTop = openAbove ? anchorTop - cardHeight - gap : anchorTop;
  return Math.max(
    header + padding,
    Math.min(naturalTop, viewportHeight - cardHeight - padding),
  );
}
