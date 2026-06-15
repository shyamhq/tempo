// Server-safe `alert` callout block spec. Registered in `plan-schema.ts`
// so `ServerBlockNoteEditor` (jsdom) can parse Agent HTML containing
// `<div class="alert alert-{warning|error|info|success}">…</div>` into a
// structured block, and emit the same wrapper back when serialising to
// external HTML (markdown export).
//
// `render` is never invoked server-side — ServerBlockNoteEditor only uses
// the schema for ProseMirror schema construction, parsing, and JSON
// transforms. The stub render exists to satisfy the BlockSpec contract.

import { createBlockSpec } from '@blocknote/core';
import {
  ALERT_BLOCK_TYPE,
  ALERT_CONTENT,
  ALERT_PROP_SCHEMA,
  type AlertVariant,
  parseAlertDiv,
} from './alert-block-shared';

export const alertBlockServer = createBlockSpec(
  {
    type: ALERT_BLOCK_TYPE,
    propSchema: ALERT_PROP_SCHEMA,
    content: ALERT_CONTENT,
  },
  {
    render: () => {
      // The dom node IS the contentDOM — keeping it flat matches the wire
      // shape produced by the client `toExternalHTML` and consumed by
      // `parseAlertDiv`. No inner wrapper.
      const dom = document.createElement('div');
      dom.className = 'bn-alert-block';
      return { dom, contentDOM: dom };
    },

    toExternalHTML: (block) => {
      const variant = (block.props as { variant: AlertVariant }).variant;
      const wrapper = document.createElement('div');
      wrapper.className = `alert alert-${variant}`;
      return { dom: wrapper, contentDOM: wrapper };
    },

    parse: parseAlertDiv,

    runsBefore: ['paragraph'],
  },
);
