import type { PlanBlock } from '@/lib/plan-schema';

// Markdown parsing always mints fresh block ids. For blocks the agent did not
// touch we want the pre-edit id back so comment marks and any external
// references (e.g. anchor offsets) stay stable. The match key is the block's
// type, depth, and plain-text fingerprint — collisions on near-duplicate text
// fall through and the new id wins, which is safer than misattributing.
export function reconcileIds(previous: PlanBlock[], parsed: PlanBlock[]): PlanBlock[] {
  const previousByKey = new Map<string, string>();
  walkWithKey(previous, 0, (block, depth) => {
    const key = fingerprint(block, depth);
    if (!previousByKey.has(key)) previousByKey.set(key, block.id);
  });

  const used = new Set<string>();
  return walkAndAssign(parsed, 0, (block, depth) => {
    const key = fingerprint(block, depth);
    const candidate = previousByKey.get(key);
    if (candidate && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    return block.id;
  });
}

function fingerprint(block: PlanBlock, depth: number): string {
  return `${depth}\0${block.type}\0${plainText(block).trim()}`;
}

function plainText(block: PlanBlock): string {
  const out: string[] = [];
  collectText(block, out);
  return out.join('');
}

function collectText(block: PlanBlock, out: string[]): void {
  const content = block.content;
  if (Array.isArray(content)) {
    for (const run of content as InlineRun[]) {
      if (typeof run.text === 'string') out.push(run.text);
      else if (Array.isArray(run.content))
        for (const r of run.content) {
          if (typeof r.text === 'string') out.push(r.text);
        }
    }
  }
}

type InlineRun = { text?: string; content?: InlineRun[] };

function walkWithKey(
  blocks: PlanBlock[],
  depth: number,
  visit: (b: PlanBlock, depth: number) => void,
): void {
  for (const block of blocks) {
    visit(block, depth);
    if (block.children?.length) walkWithKey(block.children, depth + 1, visit);
  }
}

function walkAndAssign(
  blocks: PlanBlock[],
  depth: number,
  assign: (b: PlanBlock, depth: number) => string,
): PlanBlock[] {
  return blocks.map((block) => ({
    ...block,
    id: assign(block, depth),
    children: walkAndAssign(block.children ?? [], depth + 1, assign),
  }));
}
