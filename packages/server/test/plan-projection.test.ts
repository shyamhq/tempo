// writePlan tells a comment-only edit (no agent-visible change) from a real
// content edit by comparing the blocks projection, which BlockNote builds with
// `comment` marks dropped. This pins that assumption: if a BlockNote upgrade
// ever surfaces comment marks in the projection, the suppression in writePlan
// would silently stop working — and this fails first.
import { describe, expect, test } from 'bun:test';
import { blocksToPmDoc, pmDocToBlocks } from '../src/block-html';

type PmNode = { type: string; marks?: unknown[]; content?: PmNode[] };

function stampCommentMark(pmDoc: unknown): unknown {
  const clone = structuredClone(pmDoc) as PmNode;
  const walk = (n: PmNode): void => {
    if (n.type === 'text') n.marks = [...(n.marks ?? []), { type: 'comment', attrs: { orphan: false } }];
    n.content?.forEach(walk);
  };
  walk(clone);
  return clone;
}

const para = (text: string) => blocksToPmDoc([{ type: 'paragraph', content: text }] as never);

describe('pmDocToBlocks comment-mark projection', () => {
  test('a comment-only change projects to identical blocks', () => {
    const doc = para('hello world');
    const plain = JSON.stringify(pmDocToBlocks(doc));
    const commented = JSON.stringify(pmDocToBlocks(stampCommentMark(doc)));
    expect(commented).toBe(plain);
  });

  test('a real content change still differs', () => {
    expect(JSON.stringify(pmDocToBlocks(para('hello!')))).not.toBe(
      JSON.stringify(pmDocToBlocks(para('hello'))),
    );
  });
});
