// Shared shape for the `alert` callout block — used by both the server-safe
// vanilla spec (`alert-block.server.ts`, registered in `plan-schema.ts`) and
// the client React spec (`alert-block.tsx`, registered in
// `plan-schema-client.ts`). Both schemas must agree on type / propSchema /
// content for PM JSON to round-trip, so we host the agreement here.
//
// The HTML wire shape is `<div class="alert alert-{variant}">…inline html…</div>`
// where `{variant}` is one of `warning | error | info | success`. This class
// pattern is the contract with the Agent (see `apps/agent/src/mcp-server.ts`
// tool descriptions) and with stored PM JSON — it cannot change once shipped.
// `parseAlertDiv` lives here so the client and server specs cannot disagree
// about which classes claim the element.

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
