'use client';

// The real Connectors section: the full 8-connector catalog left-joined with the
// workspace's connection state, with admin-gated connect / enable / disconnect.
// The backend is reused wholesale from @tempo/server via the thin /api/connectors
// routes; this file is presentational + the fetch/refetch orchestration.
//
// No TanStack Query in console-redo — the list is fetched with a cancel-guarded
// useEffect (mirroring the home page + thread-topbar ConnectButton), and each
// mutation re-fetches the list to refresh status. Per-row pending state is local.

import { useOrganization } from '@clerk/nextjs';
import type { ConnectorId } from '@tempo/contracts/connectors';
import { CONNECTORS } from '@tempo/contracts/connectors';
import type { ConnectorState, ConnectorStatusResponse } from '@tempo/contracts/http';
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { disconnectConnector, listConnectors, setConnectorEnabled, startConnect } from '../../api';
import { SectionFrame } from '../section-frame';

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

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; connectors: ConnectorStatusResponse['connectors'] };

export function ConnectorsSection() {
  const { membership } = useOrganization();
  const isAdmin = membership?.role === 'org:admin';

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // ponytail: a single pendingId (not a per-action set) intentionally disables
  // the whole row's buttons together while any one of its mutations is in
  // flight — connect/toggle/disconnect are mutually exclusive on a row anyway.
  const [pendingId, setPendingId] = useState<ConnectorId | null>(null);
  // Inline feedback for a failed mutation; cleared when the next one starts.
  const [error, setError] = useState<string | null>(null);

  // setState after the section unmounts (the settings modal closes mid-fetch or
  // mid-mutation-refetch) is a no-op leak; this gate skips those writes.
  const mountedRef = useRef(true);
  useEffect(() => {
    // Reset on (re)mount, not just cleanup on unmount: React StrictMode's dev
    // double-invoke runs mount→cleanup→mount, and without re-setting true here
    // the ref stays false after the remount and every fetch result is discarded
    // (stuck on "Loading…"). Set true on mount, false only on real unmount.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchConnectors = useCallback(() => {
    listConnectors()
      .then((res) => {
        if (mountedRef.current) setState({ status: 'ready', connectors: res.connectors });
      })
      .catch(() => {
        if (mountedRef.current) setState({ status: 'error' });
      });
  }, []);

  useEffect(() => fetchConnectors(), [fetchConnectors]);

  // Connecting mints a provider token server-side (a second or two for Pipedream)
  // before redirecting; keep the row pending the whole time so it never feels
  // stuck — the navigation away clears it.
  const onConnect = async (id: ConnectorId) => {
    setPendingId(id);
    setError(null);
    try {
      const { connect_url } = await startConnect(id);
      window.location.href = connect_url;
    } catch {
      if (mountedRef.current) setError("Couldn't start the connection. Try again.");
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  };

  const onToggleEnabled = async (id: ConnectorId, enabled: boolean) => {
    setPendingId(id);
    setError(null);
    try {
      await setConnectorEnabled(id, enabled);
      fetchConnectors();
    } catch {
      if (mountedRef.current) setError("Couldn't update the connector. Try again.");
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  };

  const onDisconnect = async (id: ConnectorId) => {
    setPendingId(id);
    setError(null);
    try {
      await disconnectConnector(id);
      fetchConnectors();
    } catch {
      if (mountedRef.current) setError("Couldn't disconnect. Try again.");
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  };

  // Catalog drives display order; fetched state fills status. All 8 connectors
  // show regardless of whether any workspace_connectors row exists.
  const stateById = new Map<ConnectorId, ConnectorState>(
    state.status === 'ready' ? state.connectors.map((c) => [c.connector_id, c]) : [],
  );

  return (
    <SectionFrame
      title="Connectors"
      description="Connect Tempo to the tools your team already uses. Once connected, the agent can read context from each integration during planning."
    >
      {state.status === 'loading' ? (
        <p className="py-12 text-center text-sm text-ink-3">Loading…</p>
      ) : state.status === 'error' ? (
        <p className="py-12 text-center text-sm text-danger">Couldn't load connectors.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {CONNECTORS.map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              state={stateById.get(connector.id)}
              isAdmin={isAdmin}
              isPending={pendingId === connector.id}
              onConnect={() => onConnect(connector.id)}
              onToggleEnabled={(enabled) => onToggleEnabled(connector.id, enabled)}
              onDisconnect={() => onDisconnect(connector.id)}
            />
          ))}
        </div>
      )}
      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      {!isAdmin ? (
        <p className="mt-4 text-xs text-ink-3">
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
  isPending,
  onConnect,
  onToggleEnabled,
  onDisconnect,
}: {
  connector: (typeof CONNECTORS)[number];
  state: ConnectorState | undefined;
  isAdmin: boolean;
  isPending: boolean;
  onConnect: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const Icon = CONNECTOR_ICONS[connector.id];
  const connected = state?.connected ?? false;
  const enabled = state?.enabled ?? false;

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-inset text-ink-2">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{connector.label}</span>
        {connected && state?.connected_at ? (
          <span className="text-xs text-ink-3">
            Connected {new Date(state.connected_at).toLocaleDateString()}
          </span>
        ) : null}
      </div>

      <StatusBadge connected={connected} enabled={enabled} />

      {isAdmin ? (
        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <>
              <Button
                size="sm"
                variant={enabled ? 'secondary' : 'primary'}
                onClick={() => onToggleEnabled(!enabled)}
                disabled={isPending}
              >
                {enabled ? 'Disable' : 'Enable'}
              </Button>
              {/* Disconnect — drops our workspace_connectors row. */}
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  const ok = window.confirm(
                    `Disconnect ${connector.label}? The agent will lose access immediately.`,
                  );
                  if (ok) onDisconnect();
                }}
                disabled={isPending}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={onConnect} disabled={isPending}>
              {isPending ? 'Connecting…' : 'Connect'}
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
  // Connected but allowlisted off — a dim neutral, not a warning (nothing needs
  // the admin's attention; the connector is simply switched off).
  return <Badge tone="muted">Disabled</Badge>;
}
