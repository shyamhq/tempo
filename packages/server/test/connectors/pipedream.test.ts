// Tests for the Pipedream connector transport. The sole invariant enforced here:
// every SDK call passes external_user_id / externalUserId = workspaceId. This
// is the auth model — the LLM is never an identity decision point.
//
// PIPEDREAM_* env vars are set before any module import so the lazy singleton
// in pipedream.ts constructs against these values (the `??=` guard in _setup.ts
// seeds DATABASE_URL; we extend it here for Pipedream vars).

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Seed required env vars BEFORE importing the module under test. The lazy
// singleton reads process.env at construction time on first call.
process.env.PIPEDREAM_CLIENT_ID ??= 'test-client-id';
process.env.PIPEDREAM_CLIENT_SECRET ??= 'test-client-secret';
process.env.PIPEDREAM_PROJECT_ID ??= 'proj_test';
process.env.PIPEDREAM_ENVIRONMENT ??= 'development';

// --- SDK mock ----------------------------------------------------------------
// Mock @pipedream/sdk to intercept PipedreamClient construction and record
// every call the transport layer makes. We want to assert the externalUserId
// argument — the invariant — not the full response shape.

const tokenCreate = mock(async (_opts: unknown) => ({
  connectLinkUrl: 'https://pipedream.com/connect/test-link',
  expiresAt: new Date(),
  token: 'ctok_test',
}));

const actionsRun = mock(async (_opts: unknown) => ({
  exports: { result: 'ok' },
  ret: 'ok',
}));

const accountsListByExternalUser = mock(async (_uid: string, _opts?: unknown) => [
  {
    id: 'apn_abc123',
    updatedAt: new Date('2024-06-01T00:00:00Z'),
  },
]);

// actions.list returns a (paginated, async-iterable) catalog of Components. For
// the test, a plain array suffices — `for await … of array` iterates it.
const actionsList = mock(async (opts: { app: string }) => {
  if (opts.app !== 'notion') return [];
  return [
    {
      key: 'notion-search-pages',
      name: 'Search Pages',
      description: 'Search pages in Notion',
      annotations: { readOnlyHint: true },
      configurableProps: [
        { name: 'notion', type: 'app' }, // auth prop — projection drops it
        { name: 'query', type: 'string', optional: true, description: 'Search text' },
        { name: 'internalToken', type: 'string', hidden: true }, // hidden — dropped
      ],
    },
    {
      key: 'notion-create-page',
      name: 'Create Page',
      annotations: { readOnlyHint: false },
      configurableProps: [{ name: 'notion', type: 'app' }],
    },
    {
      key: 'notion-update-page',
      name: 'Update Page',
      annotations: { destructiveHint: true }, // no readOnlyHint
      configurableProps: [],
    },
  ];
});

// PipedreamClient is instantiated lazily in pipedream.ts. The mock constructor
// returns a fake client whose sub-clients expose our tracked mocks.
const fakeClient = {
  tokens: { create: tokenCreate },
  actions: { run: actionsRun, list: actionsList },
  accounts: { listByExternalUser: accountsListByExternalUser },
};

const MockPipedreamClient = mock(() => fakeClient);

mock.module('@pipedream/sdk', () => ({
  PipedreamClient: MockPipedreamClient,
}));

// Also mock @tempo/db/client so getConnectorConfig doesn't try to connect.
mock.module('@tempo/db/client', () => ({ db: {} }));

// Mock drizzle-orm to avoid it loading the real pg client.
mock.module('drizzle-orm', () => ({
  and: mock(() => ({})),
  eq: mock(() => ({})),
}));

// Mock the queries module to control getConnectorConfig without hitting the DB.
const getConnectorConfig = mock(async (_workspaceId: string, _connectorId: string) => ({
  pipedream_account_id: 'apn_abc123',
}));

mock.module('../../src/connectors/queries', () => ({ getConnectorConfig }));

// Import after mocks are in place.
const {
  _resetPipedreamClient,
  createPipedreamConnectToken,
  dispatchIntegration,
  getPipedreamAccount,
  getActionPolicy,
  listReadActions,
} = await import('../../src/connectors/pipedream');

beforeEach(() => {
  // Reset the lazy singleton so each test gets a fresh PipedreamClient
  // constructed with the mocked constructor.
  _resetPipedreamClient();
  tokenCreate.mockClear();
  actionsRun.mockClear();
  accountsListByExternalUser.mockClear();
  getConnectorConfig.mockClear();
  MockPipedreamClient.mockClear();
});

// --- createPipedreamConnectToken ---------------------------------------------

describe('createPipedreamConnectToken', () => {
  test('passes external_user_id = workspaceId to tokens.create', async () => {
    const result = await createPipedreamConnectToken('ws_42', 'linear');

    expect(tokenCreate).toHaveBeenCalledTimes(1);
    // The invariant: externalUserId must equal the workspaceId, not any other
    // derived identity (caller jwt, user id, etc).
    const [opts] = tokenCreate.mock.calls[0] as [{ externalUserId: string }];
    expect(opts.externalUserId).toBe('ws_42');
  });

  test('a different workspaceId produces a different externalUserId', async () => {
    await createPipedreamConnectToken('ws_99', 'slack');
    const [opts] = tokenCreate.mock.calls[0] as [{ externalUserId: string }];
    expect(opts.externalUserId).toBe('ws_99');
  });

  test('appends the app slug to the Connect Link URL', async () => {
    // Pipedream rejects an app-agnostic Connect Link ("include the app in the
    // Connect URL"), so the slug must be on the URL the browser is sent to.
    const { connectLinkUrl } = await createPipedreamConnectToken('ws_42', 'notion');
    expect(new URL(connectLinkUrl).searchParams.get('app')).toBe('notion');
  });

  test('preserves any existing query string on the SDK Connect Link', async () => {
    tokenCreate.mockImplementationOnce(async () => ({
      connectLinkUrl: 'https://pipedream.com/connect/test-link?token=ctok_x',
      expiresAt: new Date(),
      token: 'ctok_x',
    }));
    const { connectLinkUrl } = await createPipedreamConnectToken('ws_42', 'linear');
    const params = new URL(connectLinkUrl).searchParams;
    expect(params.get('token')).toBe('ctok_x');
    expect(params.get('app')).toBe('linear');
  });

  test('forwards successRedirectUri to tokens.create so the flow returns to us', async () => {
    await createPipedreamConnectToken('ws_42', 'linear', 'https://console.tempo.dev/cb');
    const [opts] = tokenCreate.mock.calls[0] as [{ successRedirectUri?: string }];
    expect(opts.successRedirectUri).toBe('https://console.tempo.dev/cb');
  });
});

// --- dispatchIntegration -----------------------------------------------------

describe('dispatchIntegration', () => {
  test('passes externalUserId = workspaceId to actions.run', async () => {
    await dispatchIntegration('ws_42', 'linear', 'linear_search_issues', { query: 'auth bug' });

    expect(actionsRun).toHaveBeenCalledTimes(1);
    const [opts] = actionsRun.mock.calls[0] as [
      { id: string; externalUserId: string; configuredProps: Record<string, unknown> },
    ];
    // Core invariant: the workspace id is the external identity passed to Pipedream.
    expect(opts.externalUserId).toBe('ws_42');
    // The action component slug must be forwarded verbatim.
    expect(opts.id).toBe('linear_search_issues');
    // The account auth prop must be present so the action can authenticate.
    expect((opts.configuredProps.linear as { authProvisionId: string }).authProvisionId).toBe(
      'apn_abc123',
    );
  });

  test('caller-supplied params are forwarded in configuredProps', async () => {
    await dispatchIntegration('ws_42', 'linear', 'linear_search_issues', {
      query: 'auth bug',
      limit: 10,
    });

    const [opts] = actionsRun.mock.calls[0] as [{ configuredProps: Record<string, unknown> }];
    expect(opts.configuredProps.query).toBe('auth bug');
    expect(opts.configuredProps.limit).toBe(10);
  });

  test('uses getConnectorConfig to resolve the account id from the DB', async () => {
    await dispatchIntegration('ws_42', 'linear', 'linear_search_issues', {});

    expect(getConnectorConfig).toHaveBeenCalledWith('ws_42', 'linear');
  });

  test('caller params CANNOT override the app auth prop (DB account id wins)', async () => {
    // Security: an LLM that supplies its own `linear` prop must not be able to
    // inject an attacker-chosen authProvisionId. The spread order guarantees the
    // DB-resolved account is authoritative.
    await dispatchIntegration('ws_42', 'linear', 'linear_search_issues', {
      linear: { authProvisionId: 'ATTACKER_ACCOUNT' },
      query: 'x',
    });
    const [opts] = actionsRun.mock.calls[0] as [{ configuredProps: Record<string, unknown> }];
    expect((opts.configuredProps.linear as { authProvisionId: string }).authProvisionId).toBe(
      'apn_abc123',
    );
  });

  test('returns the SDK action response to the caller', async () => {
    const result = await dispatchIntegration('ws_42', 'linear', 'linear_search_issues', {});
    expect(result).toEqual({ exports: { result: 'ok' }, ret: 'ok' });
  });

  test('throws (without dispatching) when the connector has no stored account', async () => {
    // enabled-but-unconfigured: the connect flow never captured an account.
    getConnectorConfig.mockImplementationOnce(async () => null);

    await expect(
      dispatchIntegration('ws_42', 'linear', 'linear_search_issues', {}),
    ).rejects.toThrow(/no Pipedream account/);

    // The credential-less request must never reach Pipedream.
    expect(actionsRun).not.toHaveBeenCalled();
  });
});

// --- getPipedreamAccount -----------------------------------------------------

describe('getPipedreamAccount', () => {
  test('passes external_user_id = workspaceId to accounts.listByExternalUser', async () => {
    const result = await getPipedreamAccount('ws_42', 'linear');

    expect(accountsListByExternalUser).toHaveBeenCalledTimes(1);
    const [uid] = accountsListByExternalUser.mock.calls[0] as [string, unknown];
    // Invariant: workspace id is the external user identity.
    expect(uid).toBe('ws_42');
    expect(result).toEqual({ accountId: 'apn_abc123' });
  });

  test('filters by app slug', async () => {
    await getPipedreamAccount('ws_42', 'slack');
    const [, opts] = accountsListByExternalUser.mock.calls[0] as [string, { app: string }];
    expect(opts.app).toBe('slack');
  });

  test('returns null when no accounts are connected', async () => {
    accountsListByExternalUser.mockImplementationOnce(async () => []);
    const result = await getPipedreamAccount('ws_42', 'notion');
    expect(result).toBeNull();
  });

  test('returns the most recently updated account when multiple exist', async () => {
    accountsListByExternalUser.mockImplementationOnce(async () => [
      { id: 'apn_old', updatedAt: new Date('2024-01-01T00:00:00Z') },
      { id: 'apn_new', updatedAt: new Date('2024-06-01T00:00:00Z') },
      { id: 'apn_mid', updatedAt: new Date('2024-03-01T00:00:00Z') },
    ]);
    const result = await getPipedreamAccount('ws_42', 'linear');
    expect(result?.accountId).toBe('apn_new');
  });
});

// --- getActionPolicy (authoritative readOnlyHint, cached) --------------------

describe('getActionPolicy', () => {
  test("returns 'read' for an action Pipedream marks read-only", async () => {
    expect(await getActionPolicy('notion', 'notion-search-pages')).toBe('read');
  });

  test("returns 'write' for an action Pipedream marks a write", async () => {
    expect(await getActionPolicy('notion', 'notion-create-page')).toBe('write');
  });

  test("returns 'unknown' for an action with no readOnlyHint annotation", async () => {
    expect(await getActionPolicy('notion', 'notion-update-page')).toBe('unknown');
  });

  test("returns 'unknown' for a key not in the catalog", async () => {
    expect(await getActionPolicy('notion', 'notion-not-a-real-action')).toBe('unknown');
  });

  test('fetches the catalog once and serves repeat lookups from cache', async () => {
    // Use an app not touched above so this is a cold cache entry.
    actionsList.mockClear();
    await getActionPolicy('slack', 'slack-a');
    await getActionPolicy('slack', 'slack-b');
    expect(actionsList).toHaveBeenCalledTimes(1);
    expect(actionsList).toHaveBeenCalledWith({ app: 'slack' });
  });
});

// --- listReadActions (discovery: read actions, projected for the Agent) ------

describe('listReadActions', () => {
  test('returns only read actions, with the app-auth and hidden props dropped', async () => {
    const actions = await listReadActions('notion');
    expect(actions.map((a) => a.key)).toEqual(['notion-search-pages']);
    const [search] = actions;
    expect(search?.name).toBe('Search Pages');
    expect(search?.props).toEqual([
      { name: 'query', type: 'string', optional: true, description: 'Search text' },
    ]);
  });

  test('returns an empty list for an app with no actions', async () => {
    expect(await listReadActions('figma')).toEqual([]);
  });
});
