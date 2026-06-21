// Shared shape for the `alert` callout block — the type / propSchema / content /
// parse the client React spec (`alert-block.tsx`) registers in the plan schema.
// The server-safe vanilla variant lives in `@tempo/server` and must agree with
// this shape for PM JSON to round-trip byte-for-byte, so the agreement is hosted
// here as pure `@blocknote/core` data (no React import).
//
// The HTML wire shape is `<div class="alert alert-{variant}">…inline html…</div>`
// where `{variant}` is one of `warning | error | info | success`. This class
// pattern is the contract with the Agent and with stored PM JSON — it cannot
// change once shipped. `parseAlertDiv` lives here so the client and server specs
// cannot disagree about which classes claim the element.

export const ALERT_BLOCK_TYPE = 'alert' as const;

export const ALERT_VARIANTS = ['warning', 'error', 'info', 'success'] as const;
export type AlertVariant = (typeof ALERT_VARIANTS)[number];

export const ALERT_PROP_SCHEMA = {
  variant: { default: 'warning' as AlertVariant, values: ALERT_VARIANTS },
} as const;

export const ALERT_CONTENT = 'inline' as const;

// Returns `{ variant }` for `<div class="alert alert-{warning|error|info|success}">`,
// or undefined to let the next spec parse the element.
export function parseAlertDiv(el: HTMLElement): { variant: AlertVariant } | undefined {
  if (el.tagName !== 'DIV') return undefined;
  if (!el.classList.contains('alert')) return undefined;
  for (const v of ALERT_VARIANTS) {
    if (el.classList.contains(`alert-${v}`)) return { variant: v };
  }
  return undefined;
}
