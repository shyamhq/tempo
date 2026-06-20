// Gateway barrel for connector tools. Importing this pulls resolve.ts (auth /
// env), so tool files use it but unit tests import the leaf modules directly.
// assertConnectorEnabled moved to @tempo/server/connectors (shared by the MCP
// path and the in-process hosted tools); re-export it here so the gateway
// barrel's surface is unchanged.
export { assertConnectorEnabled } from '@tempo/server';
export { assertReadOnlyAction } from './action-policy';
export { summarize } from './audit';
export { type ConnectorCallContext, runConnectorCall } from './connector-call';
export {
  CatalogUnavailableError,
  ConnectorNotEnabledError,
  UnknownActionError,
  WriteActionRejectedError,
} from './errors';
export { resolveThreadWorkspace } from './resolve';
