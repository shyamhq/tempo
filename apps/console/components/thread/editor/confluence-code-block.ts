import CodeBlock from '@tiptap/extension-code-block';
import { mergeAttributes } from '@tiptap/core';

function languageLabel(language: string | null | undefined): string {
  if (!language) return 'Code';
  return language;
}

// Confluence-style fenced block: chrome header + gray panel body.
export const ConfluenceCodeBlock = CodeBlock.extend({
  renderHTML({ node, HTMLAttributes }) {
    const language = node.attrs.language as string | null;
    return [
      'div',
      { class: 'confluence-code-block', 'data-language': language ?? '' },
      ['div', { class: 'confluence-code-block__header' }, languageLabel(language)],
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
