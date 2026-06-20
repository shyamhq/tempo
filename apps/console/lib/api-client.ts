import {
  ConnectorOkResponse,
  ConnectorStatusResponse,
  type CreateCommentRequest,
  CreateCommentResponse,
  type CreateDiscussionMessageRequest,
  CreateDiscussionMessageResponse,
  type CreateReplyRequest,
  CreateReplyResponse,
  type CreateSpaceRequest,
  CreateSpaceResponse,
  type CreateThreadRequest,
  CreateThreadResponse,
  DeleteSpaceResponse,
  DeleteThreadResponse,
  GetConnectTokenResponse,
  GetThreadResponse,
  GetTrailsResponse,
  HostedStateResponse,
  type InitAttachmentInput,
  InitAttachmentResult,
  ListSpacesResponse,
  ListSpaceThreadsResponse,
  ListThreadsResponse,
  ResolveCommentResponse,
  type SetConnectorEnabledRequest,
  StartConnectResponse,
  UnresolveCommentResponse,
  type UpdateSpaceRequest,
  UpdateSpaceResponse,
  type UpdateThreadRequest,
  UpdateThreadResponse,
  WakeHostedResponse,
  type WritePlanRequest,
  WritePlanResponse,
} from '@tempo/contracts/http';
import { z } from 'zod';

const DeleteCommentResponse = z.object({ ok: z.literal(true) });
const OkResponse = z.object({ ok: z.literal(true) });

// Console-internal response schemas (not in @tempo/contracts).
export const GithubReposResponse = z.object({
  repos: z.array(
    z.object({
      full_name: z.string(),
      private: z.boolean(),
      description: z.string().nullable(),
      default_branch: z.string(),
    }),
  ),
});
export type GithubRepo = z.infer<typeof GithubReposResponse>['repos'][number];

const ThreadReposResponse = z.object({ repos: z.array(z.string()) });

// Workspace identity is read client-side from Clerk's hooks
// (`useOrganization`, `useOrganizationList`). Schemas below cover routes that
// hit our DB or the Clerk admin SDK — not data already available client-side.
const MemberRole = z.enum(['admin', 'member']);

const MembersResponse = z.object({
  members: z.array(
    z.object({
      user_id: z.string().nullish(),
      email: z.string().nullish(),
      first_name: z.string().nullish(),
      last_name: z.string().nullish(),
      image_url: z.string().nullish(),
      role: MemberRole,
      created_at: z.number(),
    }),
  ),
});

const InvitationsResponse = z.object({
  invitations: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      role: z.string(),
      status: z.string(),
      created_at: z.number(),
    }),
  ),
});

const CreateInvitationResponse = z.object({
  invitation: z.object({ id: z.string(), email: z.string() }),
});

export type WorkspaceMember = z.infer<typeof MembersResponse>['members'][number];
export type WorkspaceInvitation = z.infer<typeof InvitationsResponse>['invitations'][number];

// ---------------------------------------------------------------------------
// Console-side request helper (session cookie auth, relative paths)
// ---------------------------------------------------------------------------

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  responseSchema: z.ZodType<T>,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url = path;
  if (typeof window === 'undefined') {
    // RSC fetch: derive origin and forward the Clerk session cookie. Next.js
    // does not auto-attach cookies to server-side fetch() calls.
    const { headers: nextHeaders } = await import('next/headers');
    const h = await nextHeaders();
    const proto = h.get('x-forwarded-proto') ?? 'http';
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
    url = `${process.env.NEXT_PUBLIC_CONSOLE_URL ?? `${proto}://${host}`}${path}`;
    const cookie = h.get('cookie');
    if (cookie) headers.cookie = cookie;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText, path);
  }
  const json = await res.json();
  return responseSchema.parse(json);
}

// ---------------------------------------------------------------------------
// Worker-side request helper (Bearer Clerk JWT, absolute Worker URL)
// The token getter is passed per-call so callers can supply useAuth().getToken.
// ---------------------------------------------------------------------------

export const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:3001';

async function workerRequest<T>(
  method: string,
  path: string,
  body: unknown,
  responseSchema: z.ZodType<T>,
  getToken: () => Promise<string | null>,
): Promise<T> {
  const token = await getToken();
  if (!token) throw new ApiError(401, 'no_clerk_token', path);
  const url = `${WORKER_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText, path);
  }
  const json = await res.json();
  return responseSchema.parse(json);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly path: string,
  ) {
    super(`API ${status} on ${path}: ${bodyText.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Console-bound API (session cookie, server-relative paths)
// These routes live in Console and do NOT migrate to Worker.
// ---------------------------------------------------------------------------

export const api = {
  listThreads: (spaceId?: string) =>
    request(
      'GET',
      spaceId ? `/api/threads?space_id=${encodeURIComponent(spaceId)}` : '/api/threads',
      undefined,
      ListThreadsResponse,
    ),

  createThread: (input: z.infer<typeof CreateThreadRequest>) =>
    request('POST', '/api/threads', input, CreateThreadResponse),

  listSpaces: () => request('GET', '/api/spaces', undefined, ListSpacesResponse),

  createSpace: (input: z.infer<typeof CreateSpaceRequest>) =>
    request('POST', '/api/spaces', input, CreateSpaceResponse),

  updateSpace: (spaceId: string, input: z.infer<typeof UpdateSpaceRequest>) =>
    request('PATCH', `/api/spaces/${encodeURIComponent(spaceId)}`, input, UpdateSpaceResponse),

  deleteSpace: (spaceId: string) =>
    request('DELETE', `/api/spaces/${encodeURIComponent(spaceId)}`, undefined, DeleteSpaceResponse),

  listSpaceThreads: (spaceId: string) =>
    request(
      'GET',
      `/api/spaces/${encodeURIComponent(spaceId)}/threads`,
      undefined,
      ListSpaceThreadsResponse,
    ),

  getThread: (id: string) => request('GET', `/api/threads/${id}`, undefined, GetThreadResponse),
  getTrails: (id: string) =>
    request('GET', `/api/threads/${id}/trails`, undefined, GetTrailsResponse),

  getConnectToken: (threadId: string) =>
    request('GET', `/api/threads/${threadId}/connect-token`, undefined, GetConnectTokenResponse),

  getHostedState: (threadId: string) =>
    request('GET', `/api/threads/${threadId}/hosted/state`, undefined, HostedStateResponse),

  deleteThread: (threadId: string) =>
    request('DELETE', `/api/threads/${threadId}`, undefined, DeleteThreadResponse),

  updateThread: (threadId: string, input: z.infer<typeof UpdateThreadRequest>) =>
    request('PATCH', `/api/threads/${encodeURIComponent(threadId)}`, input, UpdateThreadResponse),

  updateWorkspace: (input: { name: string }) =>
    request('PATCH', '/api/workspace', input, OkResponse),

  deleteWorkspace: () => request('DELETE', '/api/workspace', undefined, OkResponse),

  listMembers: () => request('GET', '/api/workspace/members', undefined, MembersResponse),

  updateMemberRole: (userId: string, role: z.infer<typeof MemberRole>) =>
    request('PATCH', `/api/workspace/members/${userId}`, { role }, OkResponse),

  removeMember: (userId: string) =>
    request('DELETE', `/api/workspace/members/${userId}`, undefined, OkResponse),

  listInvitations: () =>
    request('GET', '/api/workspace/invitations', undefined, InvitationsResponse),

  createInvitation: (input: { email: string; role: z.infer<typeof MemberRole> }) =>
    request('POST', '/api/workspace/invitations', input, CreateInvitationResponse),

  revokeInvitation: (id: string) =>
    request('DELETE', `/api/workspace/invitations/${id}`, undefined, OkResponse),

  // --- Connectors (Settings → Integrations) --------------------------------

  listConnectors: () => request('GET', '/api/connectors', undefined, ConnectorStatusResponse),

  startConnect: (id: string) =>
    request(
      'POST',
      `/api/connectors/${encodeURIComponent(id)}/connect`,
      undefined,
      StartConnectResponse,
    ),

  setConnectorEnabled: (
    id: string,
    enabled: z.infer<typeof SetConnectorEnabledRequest>['enabled'],
  ) =>
    request(
      'PATCH',
      `/api/connectors/${encodeURIComponent(id)}`,
      { enabled } satisfies z.infer<typeof SetConnectorEnabledRequest>,
      ConnectorOkResponse,
    ),

  disconnectConnector: (id: string) =>
    request('DELETE', `/api/connectors/${encodeURIComponent(id)}`, undefined, ConnectorOkResponse),

  // Returns all GitHub repos accessible to the workspace's App installation.
  // Returns { repos: [] } when GitHub is not connected.
  listGithubRepos: () =>
    request('GET', '/api/connectors/github/repos', undefined, GithubReposResponse),

  // Returns the thread's current attached repos (["owner/name", ...]).
  getThreadRepos: (threadId: string) =>
    request(
      'GET',
      `/api/threads/${encodeURIComponent(threadId)}/repos`,
      undefined,
      ThreadReposResponse,
    ),
};

// ---------------------------------------------------------------------------
// Worker-bound API factory (Bearer Clerk JWT, absolute Worker URL)
// Pass getToken from useAuth().getToken(); Worker reads sub + org_id from the
// default Clerk session JWT — no custom JWT template needed.
// These are the routes migrated from Console → Worker in slice 1c-2b.
// ---------------------------------------------------------------------------

export function workerApi(getToken: () => Promise<string | null>) {
  const w = <T>(method: string, path: string, body: unknown, schema: z.ZodType<T>) =>
    workerRequest(method, path, body, schema, getToken);

  return {
    writePlan: (threadId: string, input: z.input<typeof WritePlanRequest>) =>
      w('POST', `/api/threads/${threadId}/plan`, input, WritePlanResponse),

    createComment: (threadId: string, input: z.input<typeof CreateCommentRequest>) =>
      w('POST', `/api/threads/${threadId}/comments`, input, CreateCommentResponse),

    resolveComment: (commentId: string) =>
      w('POST', `/api/comments/${commentId}/resolve`, {}, ResolveCommentResponse),

    unresolveComment: (commentId: string) =>
      w('POST', `/api/comments/${commentId}/unresolve`, {}, UnresolveCommentResponse),

    deleteComment: (commentId: string) =>
      w('DELETE', `/api/comments/${commentId}`, undefined, DeleteCommentResponse),

    createReply: (commentId: string, input: z.input<typeof CreateReplyRequest>) =>
      w('POST', `/api/comments/${commentId}/replies`, input, CreateReplyResponse),

    postDiscussionMessage: (
      threadId: string,
      input: z.input<typeof CreateDiscussionMessageRequest>,
    ) =>
      w(
        'POST',
        `/api/threads/${threadId}/discussion/messages`,
        input,
        CreateDiscussionMessageResponse,
      ),

    initAttachment: (threadId: string, input: z.input<typeof InitAttachmentInput>) =>
      w('POST', `/api/threads/${threadId}/attachments/init`, input, InitAttachmentResult),

    wakeHosted: (threadId: string) =>
      w('POST', `/api/threads/${threadId}/hosted/wake`, {}, WakeHostedResponse),
  };
}

// Convenience: the Worker SSE URL for the @tempo/sse-client subscription.
// The server tails from the live tail ($), or resumes from the client's
// Last-Event-ID on reconnect — no cursor param (see use-thread-events.ts).
export function workerEventsUrl(threadId: string): string {
  return `${WORKER_URL}/api/threads/${threadId}/events`;
}
