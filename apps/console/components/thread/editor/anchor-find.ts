import type { Node as PMNode } from '@tiptap/pm/model';

// Locate a Comment's anchor (a `plan_quote` substring inside a `plan_context`
// window) in the current Tiptap document and return ProseMirror positions.
// Mirrors apps/console/server/comments.ts:matches semantics: prefer exact
// quote, fall back to disambiguating by context overlap. Pure — no editor /
// no command side effects.
export function findAnchor(
  doc: PMNode,
  quote: string,
  context: string,
): { from: number; to: number } | null {
  if (!quote) return null;

  // textBetween with '\n' block separator gives us a flat string whose offsets
  // map 1:1 to the offsets we walk back to PM positions below.
  const text = doc.textBetween(0, doc.content.size, '\n');
  const occurrences: number[] = [];
  let i = text.indexOf(quote);
  while (i !== -1) {
    occurrences.push(i);
    i = text.indexOf(quote, i + 1);
  }
  if (occurrences.length === 0) return null;

  const offset =
    occurrences.length === 1 ? occurrences[0]! : pickByContext(text, occurrences, quote, context);
  return mapOffsetToRange(doc, offset, offset + quote.length);
}

function pickByContext(
  text: string,
  occurrences: number[],
  quote: string,
  context: string,
): number {
  if (!context) return occurrences[0]!;
  let best = occurrences[0]!;
  let bestScore = -1;
  for (const off of occurrences) {
    const window = text.slice(
      Math.max(0, off - 60),
      Math.min(text.length, off + quote.length + 60),
    );
    const score = overlapScore(window, context);
    if (score > bestScore) {
      bestScore = score;
      best = off;
    }
  }
  return best;
}

// Cheap character-bigram overlap. Both strings are short (~120 chars), so the
// O(n) pass and Set construction are negligible.
function overlapScore(a: string, b: string): number {
  const bigrams = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) bigrams.add(b.slice(i, i + 2));
  let hits = 0;
  for (let i = 0; i < a.length - 1; i++) {
    if (bigrams.has(a.slice(i, i + 2))) hits++;
  }
  return hits;
}

// Walk the doc counting characters the same way textBetween does (text nodes
// contribute their text; block boundaries contribute one '\n' between
// siblings). Return the PM positions that bracket [textFrom, textTo).
function mapOffsetToRange(
  doc: PMNode,
  textFrom: number,
  textTo: number,
): { from: number; to: number } | null {
  let cursor = 0;
  let from: number | null = null;
  let to: number | null = null;
  let lastBlockEnd = 0;

  doc.descendants((node, pos) => {
    if (from !== null && to !== null) return false;

    if (node.isText) {
      const len = node.text?.length ?? 0;
      const start = cursor;
      const end = cursor + len;
      if (from === null && textFrom >= start && textFrom <= end) {
        from = pos + (textFrom - start);
      }
      if (to === null && textTo >= start && textTo <= end) {
        to = pos + (textTo - start);
      }
      cursor = end;
      return false;
    }

    if (node.isBlock) {
      // Insert a synthetic '\n' between consecutive blocks to match textBetween's
      // separator behavior. lastBlockEnd tracks whether we've already accounted
      // for at least one block (no leading newline before the first block).
      if (lastBlockEnd > 0) cursor += 1;
      lastBlockEnd = pos + node.nodeSize;
    }
    return true;
  });

  if (from === null || to === null || to < from) return null;
  return { from, to };
}
