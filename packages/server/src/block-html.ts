import type { Block, PartialBlock } from '@blocknote/core';
import { ServerBlockNoteEditor } from '@blocknote/server-util';
import { CommentMark, planSchema } from './plan-schema';

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
    console.debug('block-html: blockToHtml ok', {
      ms: Date.now() - t0,
      blockType: block.type,
      htmlLen: html.length,
    });
    return html;
  } catch (err) {
    console.error('block-html: blockToHtml failed', {
      err,
      ms: Date.now() - t0,
      blockType: block.type,
      blockId: (block as { id?: string }).id,
    });
    throw err;
  }
}

export async function parseHtmlDocToBlocks(html: string): Promise<PlanPartialBlock[]> {
  const t0 = Date.now();
  try {
    const blocks = (await createEditor().tryParseHTMLToBlocks(html)) as PlanPartialBlock[];
    console.debug('block-html: parseHtmlDocToBlocks ok', {
      ms: Date.now() - t0,
      htmlLen: html.length,
      blocksOut: blocks.length,
    });
    return blocks;
  } catch (err) {
    console.error('block-html: parseHtmlDocToBlocks failed', {
      err,
      ms: Date.now() - t0,
      htmlLen: html.length,
      htmlPreview: html.slice(0, 120),
    });
    throw err;
  }
}

export function pmDocToBlocks(pmJson: unknown): PlanBlock[] {
  const t0 = Date.now();
  try {
    const blocks = createEditor()._prosemirrorJSONToBlocks(pmJson) as PlanBlock[];
    console.debug('block-html: pmDocToBlocks ok', {
      ms: Date.now() - t0,
      blocksOut: blocks.length,
    });
    return blocks;
  } catch (err) {
    const preview = (() => {
      try {
        return JSON.stringify(pmJson).slice(0, 200);
      } catch {
        return '<unstringifiable>';
      }
    })();
    console.error('block-html: pmDocToBlocks failed', {
      err,
      ms: Date.now() - t0,
      pmJsonPreview: preview,
    });
    throw err;
  }
}

export function blocksToPmDoc(blocks: PlanPartialBlock[]): unknown {
  const t0 = Date.now();
  try {
    const pm = createEditor()._blocksToProsemirrorNode(blocks).toJSON();
    console.debug('block-html: blocksToPmDoc ok', { ms: Date.now() - t0, blocksIn: blocks.length });
    return pm;
  } catch (err) {
    console.error('block-html: blocksToPmDoc failed', {
      err,
      ms: Date.now() - t0,
      blocksIn: blocks.length,
    });
    throw err;
  }
}

export type PmBlockContainer = {
  type: 'blockContainer';
  attrs: Record<string, unknown> & { id: string };
  content: unknown[];
};

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
