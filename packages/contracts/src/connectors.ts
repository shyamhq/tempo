import { z } from 'zod';

// Static catalog of every connector Tempo can surface. Shared by the Worker
// (gateway + Agent tools) and the Console (Settings → Integrations). This is the
// single source of truth for "which connectors exist"; the DB only records which
// ones a given workspace has enabled.
//
// `tier1` is GitHub alone (own GitHub App, direct REST). Every other connector is
// `tier2`, reached through the generic tempo_use_integration dispatcher over
// Pipedream. `pipedreamApp` is the Pipedream app slug passed as the `app` argument
// to the dispatcher and to the Connect flow.

export const ConnectorTier = z.enum(['tier1', 'tier2']);
export type ConnectorTier = z.infer<typeof ConnectorTier>;

export const ConnectorId = z.enum([
  'github',
  'linear',
  'jira',
  'sentry',
  'notion',
  'slack',
  'vercel',
  'figma',
]);
export type ConnectorId = z.infer<typeof ConnectorId>;

// The connectors reachable through the generic tempo_use_integration dispatcher
// — every tier2 connector, i.e. everything except GitHub (which has dedicated
// tier1 tools). The dispatcher's `app` argument is validated against this so the
// Agent can't route a tier1 connector (or an unknown app) through Pipedream.
// Mirrors the `tier: 'tier2'` rows in CONNECTORS below; keep in sync.
export const Tier2ConnectorId = z.enum([
  'linear',
  'jira',
  'sentry',
  'notion',
  'slack',
  'vercel',
  'figma',
]);
export type Tier2ConnectorId = z.infer<typeof Tier2ConnectorId>;

type ConnectorMeta = {
  id: ConnectorId;
  label: string;
  tier: ConnectorTier;
  // Present iff tier2 — the Pipedream app slug. tier1 (GitHub) has none.
  pipedreamApp?: string;
};

// Order here is the display order in the Integrations panel.
export const CONNECTORS = [
  { id: 'github', label: 'GitHub', tier: 'tier1' },
  { id: 'linear', label: 'Linear', tier: 'tier2', pipedreamApp: 'linear' },
  { id: 'jira', label: 'Jira', tier: 'tier2', pipedreamApp: 'jira' },
  { id: 'sentry', label: 'Sentry', tier: 'tier2', pipedreamApp: 'sentry' },
  { id: 'notion', label: 'Notion', tier: 'tier2', pipedreamApp: 'notion' },
  { id: 'slack', label: 'Slack', tier: 'tier2', pipedreamApp: 'slack' },
  { id: 'vercel', label: 'Vercel', tier: 'tier2', pipedreamApp: 'vercel' },
  { id: 'figma', label: 'Figma', tier: 'tier2', pipedreamApp: 'figma' },
] as const satisfies readonly ConnectorMeta[];

export const CONNECTORS_BY_ID: Record<ConnectorId, ConnectorMeta> = Object.fromEntries(
  CONNECTORS.map((c) => [c.id, c]),
) as Record<ConnectorId, ConnectorMeta>;

// The Pipedream app slug for a tier2 connector; null for github (tier1).
export function pipedreamAppFor(id: ConnectorId): string | null {
  return CONNECTORS_BY_ID[id].pipedreamApp ?? null;
}
