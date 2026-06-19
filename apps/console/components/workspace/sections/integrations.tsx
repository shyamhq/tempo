'use client';

import { useOrganization } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectorId } from '@tempo/contracts/connectors';
import { CONNECTORS } from '@tempo/contracts/connectors';
import type { ConnectorState } from '@tempo/contracts/http';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  BookOpen,
  Frame,
  GitBranch,
  GitPullRequest,
  Globe,
  MessageSquare,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { SectionFrame } from '../settings-modal';

// Maps each connector id to a Lucide icon. Chosen to reflect the real provider
// brand where Lucide has an equivalent; generic category icon otherwise.
const CONNECTOR_ICONS: Record<ConnectorId, LucideIcon> = {
  github: GitPullRequest,
  linear: GitBranch,
  jira: AlertCircle,
  sentry: Zap,
  notion: BookOpen,
  slack: MessageSquare,
  vercel: Globe,
  figma: Frame,
};

export function IntegrationsSection() {
  const qc = useQueryClient();
  const { membership } = useOrganization();
  const isAdmin = membership?.role === 'org:admin';

  const { data, isLoading } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => api.listConnectors(),
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setConnectorEnabled(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connectors'] }),
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => api.disconnectConnector(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connectors'] }),
  });

  // Connecting mints a provider token server-side (a second or two for
  // Pipedream) before redirecting — keep the button in a pending state the whole
  // time so it never feels stuck. isPending stays true until the navigation away.
  const connect = useMutation({
    mutationFn: (id: string) => api.startConnect(id),
    onSuccess: ({ connect_url }) => {
      window.location.href = connect_url;
    },
  });

  // Catalog drives display order; data fills status. All 8 connectors show
  // regardless of whether any workspace_connectors row exists.
  const stateById = new Map<ConnectorId, ConnectorState>(
    (data?.connectors ?? []).map((c) => [c.connector_id, c]),
  );

  return (
    <SectionFrame
      title="Integrations"
      description="Connect Tempo to the tools your team already uses. Once connected, the Agent can read context from each integration during planning."
    >
      {isLoading ? (
        <div className="py-12 text-center text-caption text-ink-tertiary">Loading…</div>
      ) : (
        <div className="flex flex-col divide-y divide-hairline rounded-xl border border-hairline">
          {CONNECTORS.map((connector) => {
            const state = stateById.get(connector.id);
            return (
              <ConnectorRow
                key={connector.id}
                connector={connector}
                state={state}
                isAdmin={isAdmin}
                onConnect={() => connect.mutate(connector.id)}
                onToggleEnabled={(enabled) => toggleEnabled.mutate({ id: connector.id, enabled })}
                onDisconnect={() => disconnect.mutate(connector.id)}
                isConnectPending={connect.isPending && connect.variables === connector.id}
                isTogglePending={
                  toggleEnabled.isPending && toggleEnabled.variables?.id === connector.id
                }
                isDisconnectPending={disconnect.isPending && disconnect.variables === connector.id}
              />
            );
          })}
        </div>
      )}
      {!isAdmin ? (
        <p className="mt-4 text-micro text-ink-tertiary">
          Only workspace admins can connect or disconnect integrations.
        </p>
      ) : null}
    </SectionFrame>
  );
}

function ConnectorRow({
  connector,
  state,
  isAdmin,
  onConnect,
  onToggleEnabled,
  onDisconnect,
  isConnectPending,
  isTogglePending,
  isDisconnectPending,
}: {
  connector: (typeof CONNECTORS)[number];
  state: ConnectorState | undefined;
  isAdmin: boolean;
  onConnect: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
  isConnectPending: boolean;
  isTogglePending: boolean;
  isDisconnectPending: boolean;
}) {
  const Icon = CONNECTOR_ICONS[connector.id];
  const connected = state?.connected ?? false;
  const enabled = state?.enabled ?? false;

  return (
    <div className="flex items-center gap-4 px-5 py-4">
      {/* Icon */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-ink-muted">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>

      {/* Label + status */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-caption-bold text-ink">{connector.label}</span>
        {connected && state?.connected_at ? (
          <span className="text-micro text-ink-tertiary">
            Connected {new Date(state.connected_at).toLocaleDateString()}
          </span>
        ) : null}
      </div>

      {/* Status badge */}
      <StatusBadge connected={connected} enabled={enabled} />

      {/* Admin controls */}
      {isAdmin ? (
        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <>
              {/* Enable / Disable toggle */}
              <Button
                size="sm"
                variant={enabled ? 'secondary' : 'accent'}
                onClick={() => onToggleEnabled(!enabled)}
                disabled={isTogglePending}
              >
                {enabled ? 'Disable' : 'Enable'}
              </Button>
              {/* Disconnect — drops our workspace_connectors row */}
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  const ok = window.confirm(
                    `Disconnect ${connector.label}? The Agent will lose access immediately.`,
                  );
                  if (ok) onDisconnect();
                }}
                disabled={isDisconnectPending}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={onConnect} disabled={isConnectPending}>
              {isConnectPending ? 'Connecting…' : 'Connect'}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ connected, enabled }: { connected: boolean; enabled: boolean }) {
  if (!connected) {
    return <Badge tone="neutral">Not connected</Badge>;
  }
  if (enabled) {
    return <Badge tone="success">Active</Badge>;
  }
  return <Badge tone="muted">Disabled</Badge>;
}
