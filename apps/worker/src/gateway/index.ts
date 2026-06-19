// Gateway barrel for connector tools. Importing this pulls resolve.ts (auth /
// env), so tool files use it but unit tests import the leaf modules directly.
export { assertReadOnlyAction } from './action-policy';
export { summarize } from './audit';
export {
  assertConnectorEnabled,
  type ConnectorCallContext,
  runConnectorCall,
} from './connector-call';
export {
  CatalogUnavailableError,
  ConnectorNotEnabledError,
  UnknownActionError,
  WriteActionRejectedError,
} from './errors';
export { resolveThreadWorkspace } from './resolve';
