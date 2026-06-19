import { getActionPolicy } from '@tempo/server';
import { logger } from '../logger';
import { CatalogUnavailableError, UnknownActionError, WriteActionRejectedError } from './errors';

// The tier-2 read-only gate. Pipedream's action catalog is the single source of
// truth: an action is allowed iff it exists in the catalog AND Pipedream marks
// it read-only (readOnlyHint). A write is rejected; an unknown or unannotated
// key is rejected too (the Agent should discover valid keys via
// tempo_list_integration_actions). Fail closed: if the catalog can't be fetched
// we cannot prove read-only, so we refuse rather than dispatch blind.
export async function assertReadOnlyAction(app: string, action: string): Promise<void> {
  let policy: 'read' | 'write' | 'unknown';
  try {
    policy = await getActionPolicy(app, action);
  } catch (err) {
    logger.warn({ err, app, action }, 'connector: action catalog lookup failed; rejecting');
    throw new CatalogUnavailableError(app);
  }

  if (policy === 'read') return;
  if (policy === 'write') throw new WriteActionRejectedError(action);
  throw new UnknownActionError(action);
}
