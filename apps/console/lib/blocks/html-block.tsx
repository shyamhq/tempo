'use client';

// Client React variant of the `htmlBlock`. Registered in
// `plan-schema-client.ts` for the live editor surface. `@blocknote/react`
// calls `createContext` at module load — so the entire transitive import
// graph from here is client-only. Server uses `html-block.server.ts`.
// Both specs share `html-block-shared.ts` so they agree on type /
// propSchema / content / parse and the PM JSON round-trips byte-for-byte.

import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  PartialBlock,
  StyleSchema,
} from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import {
  type BlockTypeSelectItem,
  createReactBlockSpec,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { Code2 } from 'lucide-react';
import {
  HTML_BLOCK_TYPE,
  HTML_CONTENT,
  HTML_PROP_SCHEMA,
  parseHtmlBlockPre,
} from './html-block-shared';
import { HtmlRenderer } from './html-renderer';

// Seed inserted on slash-menu creation so the Dev sees the block working
// immediately (preview-mode iframe with a small rendered example) rather
// than landing on a blank surface. Hints at the editing workflow in its
// own copy. Block-type-select keeps the existing paragraph's content (the
// Dev is converting in-place), so the seed only fires for slash.
const SEED_HTML = `<div style="padding:1.5rem;text-align:center;font-family:sans-serif">
  <button style="padding:10px 20px;font-size:14px;color:#fff;background:#0a0a0a;border:0;border-radius:8px;cursor:pointer" onclick="this.textContent='Clicked!'">Hello, htmlBlock</button>
  <p style="margin:0.75rem 0 0;color:#64748b;font-size:12px">Click <code>&lt;/&gt;</code> to edit this source.</p>
</div>`;

export const htmlBlock = createReactBlockSpec(
  {
    type: HTML_BLOCK_TYPE,
    propSchema: HTML_PROP_SCHEMA,
    content: HTML_CONTENT,
  },
  {
    render: ({ block, editor }) => (
      <HtmlRenderer
        html={block.props.html}
        height={block.props.height}
        onSourceCommit={(html) => {
          editor.updateBlock(block, { props: { html } });
        }}
        onResizeCommit={(height) => {
          editor.updateBlock(block, { props: { height } });
        }}
      />
    ),

    toExternalHTML: ({ block }) => (
      <pre>
        <code className="language-html-block" data-language="html-block">
          {block.props.html}
        </code>
      </pre>
    ),

    parse: parseHtmlBlockPre,

    // Wins over `codeBlock`'s generic `<pre>` match so our element gets
    // parsed back into an htmlBlock instead of a plain code block.
    runsBefore: ['codeBlock'],
  },
);

// Generics mirror `getDefaultReactSlashMenuItems` so this composes with it at
// the call site. `BlockNoteEditor` is invariant in BSchema, so an
// unparameterized base type would reject the schema'd editor.
export function htmlSlashItem<
  BSchema extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>(editor: BlockNoteEditor<BSchema, I, S>): DefaultReactSuggestionItem {
  return {
    title: 'HTML block',
    subtext: 'Embed a rendered HTML page',
    aliases: ['html', 'iframe', 'embed', 'prototype'],
    group: 'Basic blocks',
    icon: <Code2 size={18} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: HTML_BLOCK_TYPE,
        props: { html: SEED_HTML },
      } as PartialBlock<BSchema, I, S>);
    },
  };
}

// `BlockTypeSelectItem.icon` expects `react-icons`'s `IconType`. Lucide icons
// accept a structurally-compatible prop shape but the nominal types differ —
// one cast keeps us on a single icon library without pulling in `react-icons`.
export const htmlBlockTypeItem: BlockTypeSelectItem = {
  name: 'HTML block',
  type: HTML_BLOCK_TYPE,
  icon: Code2 as unknown as BlockTypeSelectItem['icon'],
};
