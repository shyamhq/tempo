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
  return createEditor().blocksToHTMLLossy([block]);
}

export async function parseHtmlDocToBlocks(html: string): Promise<PlanPartialBlock[]> {
  return (await createEditor().tryParseHTMLToBlocks(html)) as PlanPartialBlock[];
}

export function pmDocToBlocks(pmJson: unknown): PlanBlock[] {
  return createEditor()._prosemirrorJSONToBlocks(pmJson) as PlanBlock[];
}

export function blocksToPmDoc(blocks: PlanPartialBlock[]): unknown {
  return createEditor()._blocksToProsemirrorNode(blocks).toJSON();
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
