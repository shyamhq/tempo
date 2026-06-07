import type { PlanBlock } from '@/lib/plan-schema';
import { decodeStyles } from './encode';
import { reconcileIds } from './reconcile-ids';
import { serverPlanEditor } from './server-editor';

// Parses the agent's annotated Markdown back into a block tree, then walks
// every inline text run, splits on the self-describing sentinel pairs, and
// re-applies the encoded styles. The protocol is stateless — the marker
// carries its own styles — so no sidecar flows between pull and write.
//
// Tolerated agent edits:
//   1. Marker preserved verbatim with original text — happy path.
//   2. Marker preserved, wrapped text rewritten — styles follow the new text.
//      This is the property we built the format for.
//   3. Marker deleted entirely — the styled span is gone, the text remains
//      unstyled. Accepted.
//   4. Half-deleted marker — no closing or no opening — drop silently.
//   5. Style token corrupted — decode returns null, the marker is treated
//      as plain text and stripped from output.
export async function decodeFromAgent(
  markdown: string,
  previousBlocks: PlanBlock[],
): Promise<PlanBlock[]> {
  const parsed = await serverPlanEditor.tryParseMarkdownToBlocks(markdown);
  const restyled = restyleBlocks(parsed as PlanBlock[]);
  return reconcileIds(previousBlocks, restyled);
}

// Match a `⟦sty:TOKEN⟧…⟦/sty:TOKEN⟧` pair where TOKEN is URL-safe base64.
// Constructed fresh per call so the `g` flag's `lastIndex` cannot race
// across concurrent server requests.
const SENTINEL_PATTERN = '⟦sty:([A-Za-z0-9_-]+)⟧([\\s\\S]*?)⟦\\/sty:\\1⟧';

function restyleBlocks(blocks: PlanBlock[]): PlanBlock[] {
  return blocks.map((block) => {
    const next: PlanBlock = { ...block, children: restyleBlocks(block.children ?? []) };
    if (Array.isArray(block.content)) {
      next.content = restyleInline(block.content as InlineRun[]) as PlanBlock['content'];
    }
    return next;
  });
}

type InlineRun = { type: string; text?: string; styles?: Record<string, unknown> };

function restyleInline(runs: InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const run of runs) {
    if (run.type !== 'text' || typeof run.text !== 'string') {
      out.push(run);
      continue;
    }
    out.push(...splitOnSentinels(run));
  }
  return mergeAdjacentRuns(out);
}

function splitOnSentinels(run: InlineRun): InlineRun[] {
  const text = run.text ?? '';
  const regex = new RegExp(SENTINEL_PATTERN, 'g');
  if (!regex.test(text)) return [run];

  const out: InlineRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(new RegExp(SENTINEL_PATTERN, 'g'))) {
    const [whole, token, inner] = match;
    const start = match.index ?? 0;
    if (start > cursor) out.push({ ...run, text: text.slice(cursor, start) });
    const decoded = token ? decodeStyles(token) : null;
    out.push({
      ...run,
      text: inner,
      styles: { ...(run.styles ?? {}), ...(decoded ?? {}) },
    });
    cursor = start + whole.length;
  }
  if (cursor < text.length) out.push({ ...run, text: text.slice(cursor) });
  return out;
}

function mergeAdjacentRuns(runs: InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (
      last &&
      last.type === 'text' &&
      run.type === 'text' &&
      stylesEqual(last.styles ?? {}, run.styles ?? {})
    ) {
      out[out.length - 1] = { ...last, text: (last.text ?? '') + (run.text ?? '') };
    } else {
      out.push(run);
    }
  }
  return out;
}

function stylesEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) if (a[key] !== b[key]) return false;
  return true;
}
