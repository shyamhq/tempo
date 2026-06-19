import { TempoError } from '@tempo/errors';

// The connector is not enabled for this workspace — the allowlist gate said no.
// Surfaces to the Agent as an error result (not an HTTP status; connector tool
// errors travel in the MCP tool response body).
export class ConnectorNotEnabledError extends TempoError {
  constructor(connectorId: string) {
    super(
      'connector_not_enabled',
      403,
      `connector "${connectorId}" is not enabled for this workspace`,
    );
  }
}

// The dispatcher refused a non-read action before it reached Pipedream.
export class WriteActionRejectedError extends TempoError {
  constructor(action: string) {
    super(
      'write_action_rejected',
      403,
      `action "${action}" is not read-only; tempo_use_integration permits reads only`,
    );
  }
}

// The action key isn't a known read action for this app (not in Pipedream's
// catalog, or unannotated). Points the Agent at discovery instead of letting a
// guessed key reach Pipedream and 404.
export class UnknownActionError extends TempoError {
  constructor(action: string) {
    super(
      'unknown_action',
      404,
      `action "${action}" is not a known read action; call tempo_list_integration_actions to list valid actions`,
    );
  }
}

// The action catalog couldn't be fetched (Pipedream unavailable / rate-limited).
// Distinct from UnknownActionError so the Agent retries the same call rather than
// chasing discovery — which would fail the same way. The gate fails closed: no
// catalog means we can't prove read-only, so we refuse.
export class CatalogUnavailableError extends TempoError {
  constructor(app: string) {
    super(
      'catalog_unavailable',
      503,
      `the action catalog for "${app}" is temporarily unavailable; retry shortly`,
    );
  }
}
