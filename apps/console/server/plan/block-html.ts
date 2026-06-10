import type { Block, PartialBlock } from '@blocknote/core';
import { ServerBlockNoteEditor } from '@blocknote/server-util';
import { CommentMark, planSchema } from '../../lib/plan-schema';
import { logger } from '../../logger';

type PlanSchema = typeof planSchema;
type PlanPartialBlock = PartialBlock<
  PlanSchema['blockSchema'],
  PlanSchema['inlineContentSchema'],
  PlanSchema['styleSchema']
>;
type PlanBlock = Block<
  PlanSchema['blockSchema'],
  PlanSchema['inlineContentSchema'],
  PlanSchema['styleSchema']
>;

// The server-side editor must register the `comment` mark (see plan-schema.ts)
// so prosemirror-model can parse pm_json from a Plan that has anchored Comments.
// Without this, every block carrying a comment mark trips
// `RangeError: There is no mark type comment in this schema` on parse.
function createEditor() {
  return ServerBlockNoteEditor.create({
    schema: planSchema,
    _tiptapOptions: { extensions: [CommentMark] },
  });
}

export async function blockToHtml(block: PlanPartialBlock): Promise<string> {
  const t0 = Date.now();
  try {
    const html = await createEditor().blocksToHTMLLossy([block]);
    logger.debug(
      { ms: Date.now() - t0, blockType: block.type, htmlLen: html.length },
      'block-html: blockToHtml ok',
    );
    return html;
  } catch (err) {
    logger.error(
      { err, ms: Date.now() - t0, blockType: block.type, blockId: (block as { id?: string }).id },
      'block-html: blockToHtml failed',
    );
    throw err;
  }
}

export async function parseHtmlDocToBlocks(html: string): Promise<PlanPartialBlock[]> {
  const t0 = Date.now();
  try {
    const blocks = (await createEditor().tryParseHTMLToBlocks(html)) as PlanPartialBlock[];
    logger.debug(
      { ms: Date.now() - t0, htmlLen: html.length, blocksOut: blocks.length },
      'block-html: parseHtmlDocToBlocks ok',
    );
    return blocks;
  } catch (err) {
    logger.error(
      { err, ms: Date.now() - t0, htmlLen: html.length, htmlPreview: html.slice(0, 120) },
      'block-html: parseHtmlDocToBlocks failed',
    );
    throw err;
  }
}

export function pmDocToBlocks(pmJson: unknown): PlanBlock[] {
  const t0 = Date.now();
  try {
    const blocks = createEditor()._prosemirrorJSONToBlocks(pmJson) as PlanBlock[];
    logger.debug({ ms: Date.now() - t0, blocksOut: blocks.length }, 'block-html: pmDocToBlocks ok');
    return blocks;
  } catch (err) {
    const preview = (() => {
      try {
        return JSON.stringify(pmJson).slice(0, 200);
      } catch {
        return '<unstringifiable>';
      }
    })();
    logger.error(
      { err, ms: Date.now() - t0, pmJsonPreview: preview },
      'block-html: pmDocToBlocks failed',
    );
    throw err;
  }
}

export function blocksToPmDoc(blocks: PlanPartialBlock[]): unknown {
  const t0 = Date.now();
  try {
    const pm = createEditor()._blocksToProsemirrorNode(blocks).toJSON();
    logger.debug({ ms: Date.now() - t0, blocksIn: blocks.length }, 'block-html: blocksToPmDoc ok');
    return pm;
  } catch (err) {
    logger.error(
      { err, ms: Date.now() - t0, blocksIn: blocks.length },
      'block-html: blocksToPmDoc failed',
    );
    throw err;
  }
}

// Shape of a single blockContainer node in BlockNote's pm_json. Each top-level
// child of the doc's root blockGroup is one of these.
export type PmBlockContainer = {
  type: 'blockContainer';
  attrs: Record<string, unknown> & { id: string };
  content: unknown[];
};

// Convert an HTML string into PM blockContainer nodes (one per top-level block
// the editor parses out). Used by the write orchestrators in plan.ts to splice
// new content into the original pm_json by array index — *without*
// round-tripping the whole document through `pmDocToBlocks` + `blocksToPmDoc`,
// which would discard every `comment` mark in the doc (the editor tags it
// `blocknoteIgnore: true` in `extendMarkSchema`, so its Block model never
// carries it). Returns `[]` when the HTML yields no blocks; callers decide
// what that means. Throws if the editor produces partials but `blocksToPmDoc`
// then refuses to materialise them — a server-side editor fault.
export async function htmlToPmBlockContainers(html: string): Promise<PmBlockContainer[]> {
  const partials = await parseHtmlDocToBlocks(html);
  if (partials.length === 0) return [];
  const pmDoc = blocksToPmDoc(partials) as {
    content?: Array<{ content?: PmBlockContainer[] }>;
  };
  const containers = pmDoc.content?.[0]?.content;
  if (!containers || containers.length === 0) {
    throw new Error('htmlToPmBlockContainers: blocksToPmDoc produced no blockContainers');
  }
  return containers;
}
