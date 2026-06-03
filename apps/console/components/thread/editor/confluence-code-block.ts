import CodeBlock from '@tiptap/extension-code-block';
import { mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CodeBlockView } from './code-block-view';

export const ConfluenceCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  renderHTML({ node, HTMLAttributes }) {
    const language = node.attrs.language as string | null;
    return [
      'div',
      { class: 'confluence-code-block', 'data-language': language ?? '' },
      ['div', { class: 'confluence-code-block__header' }, language ?? 'Code'],
      [
        'pre',
        mergeAttributes(HTMLAttributes, { class: 'confluence-code-block__pre' }),
        [
          'code',
          {
            class: language ? this.options.languageClassPrefix + language : null,
          },
          0,
        ],
      ],
    ];
  },

  parseHTML() {
    return [
      {
        tag: 'div.confluence-code-block',
        preserveWhitespace: 'full',
        contentElement: 'pre',
      },
      {
        tag: 'pre',
        preserveWhitespace: 'full',
      },
    ];
  },
});
