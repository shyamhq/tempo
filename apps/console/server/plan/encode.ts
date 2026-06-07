import type { PartialBlock } from '@blocknote/core';
import type { PlanBlock } from '@/lib/plan-schema';
import { serverPlanEditor } from './server-editor';

// Wraps every inline run carrying non-default styles in a self-describing
// sentinel pair before delegating to BlockNote's lossy Markdown serializer.
// The styles are encoded directly inside the marker (base64-JSON) so the
// protocol is stateless — `tempo_pull_plan` emits annotated Markdown and
// `tempo_write_plan` reads it back without any shared sidecar state across
// the round trip. The Unicode-bracket form ⟦…⟧ survives CommonMark
// parsing where inline HTML and HTML comments get stripped by the remark
// pipeline BlockNote uses.
export async function encodeForAgent(blocks: PlanBlock[]): Promise<string> {
  const annotated = annotateBlocks(blocks);
  return serverPlanEditor.blocksToMarkdownLossy(annotated as PartialBlock[]);
}

function annotateBlocks(blocks: PlanBlock[]): PlanBlock[] {
  return blocks.map(annotateBlock);
}

function annotateBlock(block: PlanBlock): PlanBlock {
  const next: PlanBlock = { ...block, children: annotateBlocks(block.children ?? []) };
  if (Array.isArray(block.content)) {
    next.content = annotateInline(block.content as InlineRun[]) as PlanBlock['content'];
  }
  return next;
}

type InlineRun = {
  type: string;
  text?: string;
  styles?: Record<string, unknown>;
};

function annotateInline(runs: InlineRun[]): InlineRun[] {
  return runs.map((run) => {
    if (run.type !== 'text' || typeof run.text !== 'string') return run;
    const opaqueStyles = pickOpaqueStyles(run.styles ?? {});
    if (Object.keys(opaqueStyles).length === 0) return run;
    const token = encodeStyles(opaqueStyles);
    return {
      ...run,
      // Strip the styles we're encoding into the sentinel so the Markdown
      // serializer doesn't double-encode them. Keep the marks BlockNote can
      // already represent in Markdown (bold/italic/code/strike) so the agent
      // sees them as native syntax.
      styles: filterStyles(run.styles ?? {}, MARKDOWN_REPRESENTABLE_STYLES),
      text: `⟦sty:${token}⟧${run.text}⟦/sty:${token}⟧`,
    };
  });
}

// "Opaque" = styles Markdown cannot express. Everything else (bold, italic,
// code, strike) round-trips natively and doesn't need wrapping.
function pickOpaqueStyles(styles: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (MARKDOWN_REPRESENTABLE_STYLES.has(key)) continue;
    if (value === undefined || value === false || value === '' || value === 'default') continue;
    out[key] = value;
  }
  return out;
}

const MARKDOWN_REPRESENTABLE_STYLES = new Set(['bold', 'italic', 'code', 'strike']);

function filterStyles(
  styles: Record<string, unknown>,
  keep: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (keep.has(key)) out[key] = value;
  }
  return out;
}

// URL-safe base64 keeps the marker free of `=` and `/` so the agent doesn't
// mistake them for syntax it should fix up.
export function encodeStyles(styles: Record<string, unknown>): string {
  const json = JSON.stringify(styles);
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Allowlist of style keys that are valid inside a sentinel. An agent that
// fabricates a sentinel cannot persist arbitrary keys to the database — only
// the styles the encoder would have emitted in the first place are accepted.
const RESTORABLE_STYLE_KEYS = new Set(['textColor', 'backgroundColor', 'commentThread']);

export function decodeStyles(token: string): Record<string, unknown> | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (RESTORABLE_STYLE_KEYS.has(key)) out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}
