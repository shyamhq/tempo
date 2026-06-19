// The tier-2 read-only gate. Pipedream's catalog is the single source of truth:
// 'read' allows, 'write' rejects, and an unknown/unannotated key rejects too
// (no verb heuristic). A catalog-fetch failure fails closed.
import { beforeEach, describe, expect, test } from 'bun:test';
import { installTempoServerMock } from '../_mocks/tempo-server';

const server = installTempoServerMock();
const { assertReadOnlyAction } = await import('../../src/gateway/action-policy');
const { CatalogUnavailableError, UnknownActionError, WriteActionRejectedError } = await import(
  '../../src/gateway/errors'
);

beforeEach(() => server.reset());

describe('assertReadOnlyAction', () => {
  test('allows an action Pipedream marks read-only', async () => {
    server.getActionPolicy.mockResolvedValue('read');
    await expect(assertReadOnlyAction('notion', 'notion-search-pages')).resolves.toBeUndefined();
  });

  test('rejects an action Pipedream marks a write', async () => {
    server.getActionPolicy.mockResolvedValue('write');
    await expect(assertReadOnlyAction('notion', 'notion-create-page')).rejects.toBeInstanceOf(
      WriteActionRejectedError,
    );
  });

  test('rejects an unknown/unannotated key (not in the catalog)', async () => {
    server.getActionPolicy.mockResolvedValue('unknown');
    await expect(assertReadOnlyAction('notion', 'notion-not-a-real-action')).rejects.toBeInstanceOf(
      UnknownActionError,
    );
  });

  test('fails closed with CatalogUnavailableError when the lookup throws', async () => {
    server.getActionPolicy.mockImplementation(async () => {
      throw new Error('pipedream down');
    });
    // Distinct from UnknownActionError: a valid key during an outage should tell
    // the Agent to retry, not to go re-discover (which would also fail).
    await expect(assertReadOnlyAction('notion', 'notion-search-pages')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });
});
