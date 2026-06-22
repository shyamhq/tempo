'use client';

// Client React variant of the `alert` callout block, registered in the plan
// schema (`features/plan/schema.ts`) for the live editor surface.
// `@blocknote/react` calls `createContext` at module load — so the entire
// transitive import graph from here is client-only. Both this and the
// server-safe vanilla spec in `@tempo/server` share `alert-block-shared.ts` so
// they agree on type / propSchema / content / parse and the PM JSON round-trips
// byte-for-byte.

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
import { AlertTriangle, CheckCircle2, Info, type LucideIcon, XCircle } from 'lucide-react';
import {
  ALERT_BLOCK_TYPE,
  ALERT_CONTENT,
  ALERT_PROP_SCHEMA,
  ALERT_VARIANTS,
  type AlertVariant,
  parseAlertDiv,
} from './alert-block-shared';

type VariantMeta = {
  label: string;
  Icon: LucideIcon;
  subtext: string;
  // Tailwind class string for the rendered block container. Static strings so
  // Tailwind v4 can find them at build time — no dynamic interpolation.
  containerClass: string;
  iconClass: string;
};

const VARIANT_META: Record<AlertVariant, VariantMeta> = {
  warning: {
    label: 'Warning',
    Icon: AlertTriangle,
    subtext: 'Caution callout',
    containerClass: 'border-amber-200 bg-amber-50/70 text-amber-950',
    iconClass: 'text-amber-600',
  },
  error: {
    label: 'Error',
    Icon: XCircle,
    subtext: 'Failure callout',
    containerClass: 'border-red-200 bg-red-50/70 text-red-950',
    iconClass: 'text-red-600',
  },
  info: {
    label: 'Info',
    Icon: Info,
    subtext: 'Note callout',
    containerClass: 'border-sky-200 bg-sky-50/70 text-sky-950',
    iconClass: 'text-sky-600',
  },
  success: {
    label: 'Success',
    Icon: CheckCircle2,
    subtext: 'Confirmation callout',
    containerClass: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
    iconClass: 'text-emerald-600',
  },
};

function nextVariant(current: AlertVariant): AlertVariant {
  const i = ALERT_VARIANTS.indexOf(current);
  return ALERT_VARIANTS[(i + 1) % ALERT_VARIANTS.length] ?? 'warning';
}

export const alertBlock = createReactBlockSpec(
  {
    type: ALERT_BLOCK_TYPE,
    propSchema: ALERT_PROP_SCHEMA,
    content: ALERT_CONTENT,
  },
  {
    render: ({ block, editor, contentRef }) => {
      const variant = block.props.variant as AlertVariant;
      const meta = VARIANT_META[variant];
      const Icon = meta.Icon;
      return (
        <div
          className={`bn-alert-block alert alert-${variant} my-1 flex items-start gap-2 rounded-md border px-3 py-2 ${meta.containerClass}`}
          data-variant={variant}
        >
          <button
            type="button"
            className={`mt-0.5 shrink-0 rounded-sm hover:opacity-80 ${meta.iconClass}`}
            contentEditable={false}
            title={`${meta.label} — click to cycle variant`}
            onClick={() =>
              // `content: block.content` is load-bearing: `updateBlock` treats
              // a missing `content` field as "clear" and would erase whatever
              // the Dev typed into the callout.
              editor.updateBlock(block, {
                type: ALERT_BLOCK_TYPE,
                props: { variant: nextVariant(variant) },
                content: block.content,
              })
            }
          >
            <Icon size={18} />
          </button>
          <div ref={contentRef} className="flex-1 min-w-0" />
        </div>
      );
    },

    toExternalHTML: ({ block, contentRef }) => {
      const variant = block.props.variant as AlertVariant;
      // contentRef attaches to the outer div so the serialized shape is the
      // flat `<div class="alert alert-{variant}">…inline…</div>` the parser
      // and MCP tool descriptions advertise — no extra inner wrapper.
      return <div className={`alert alert-${variant}`} ref={contentRef} />;
    },

    parse: (el) => parseAlertDiv(el),

    // The alert's parse rule wins over `paragraph` whose generic `<div>`
    // match would otherwise claim our element first.
    runsBefore: ['paragraph'],
  },
);

// Generics mirror `getDefaultReactSlashMenuItems` so this composes with it at
// the call site. `BlockNoteEditor` is invariant in BSchema, so an
// unparameterized base type would reject the schema'd editor — the generics
// are not decorative.
export function alertSlashItems<
  BSchema extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>(editor: BlockNoteEditor<BSchema, I, S>): DefaultReactSuggestionItem[] {
  return ALERT_VARIANTS.map((variant) => {
    const meta = VARIANT_META[variant];
    const Icon = meta.Icon;
    return {
      title: `${meta.label} callout`,
      subtext: meta.subtext,
      aliases: ['alert', 'callout', 'note', variant],
      group: 'Basic blocks',
      icon: <Icon size={18} />,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: ALERT_BLOCK_TYPE,
          props: { variant },
        } as PartialBlock<BSchema, I, S>);
      },
    };
  });
}

// One block-type-select item per variant. The toolbar's BlockTypeSelect calls
// `editor.updateBlock` on the selected block when an item is clicked, so
// converting an existing paragraph to an alert is one click away.
//
// `BlockTypeSelectItem.icon` expects `react-icons`'s `IconType` (a function
// that takes `IconBaseProps`). Lucide icons accept a structurally-compatible
// prop shape, but the nominal types differ — one cast at this boundary keeps
// us on a single icon library (`lucide-react`) without pulling in
// `react-icons` as a direct dep just for the type.
export const alertBlockTypeItems: BlockTypeSelectItem[] = ALERT_VARIANTS.map((variant) => {
  const meta = VARIANT_META[variant];
  return {
    name: `${meta.label} callout`,
    type: ALERT_BLOCK_TYPE,
    props: { variant },
    icon: meta.Icon as unknown as BlockTypeSelectItem['icon'],
  };
});
