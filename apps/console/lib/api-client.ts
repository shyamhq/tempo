import {
  ApproveThreadResponse,
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
  type InitAttachmentInput,
  InitAttachmentResult,
  ListSpacesResponse,
  ListSpaceThreadsResponse,
  ListThreadsResponse,
  RecheckPlanResponse,
  ReopenThreadResponse,
  ResolveCommentResponse,
  UnresolveCommentResponse,
  type UpdateSpaceRequest,
  UpdateSpaceResponse,
  type UpdateThreadRequest,
  UpdateThreadResponse,
  type WritePlanRequest,
  WritePlanResponse,
} from '@tempo/contracts/http';
import { z } from 'zod';

const DeleteCommentResponse = z.object({ ok: z.literal(true) });
const OkResponse = z.object({ ok: z.literal(true) });

// Workspace identity is read client-side from Clerk's hooks
// (`useOrganization`, `useOrganizationList`); no GET schemas live here.
// Only mutation-response shapes for routes that hit our DB or the Clerk
// admin SDK belong below.
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

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly path: string,
  ) {
    super(`API ${status} on ${path}: ${bodyText.slice(0, 200)}`);
  }
}

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

  getConnectToken: (threadId: string) =>
    request('GET', `/api/threads/${threadId}/connect-token`, undefined, GetConnectTokenResponse),

  writePlan: (threadId: string, input: z.infer<typeof WritePlanRequest>) =>
    request('POST', `/api/threads/${threadId}/plan`, input, WritePlanResponse),

  recheckPlan: (threadId: string) =>
    request('POST', `/api/threads/${threadId}/plan/recheck`, {}, RecheckPlanResponse),

  createComment: (threadId: string, input: z.input<typeof CreateCommentRequest>) =>
    request('POST', `/api/threads/${threadId}/comments`, input, CreateCommentResponse),

  resolveComment: (commentId: string) =>
    request('POST', `/api/comments/${commentId}/resolve`, {}, ResolveCommentResponse),

  unresolveComment: (commentId: string) =>
    request('POST', `/api/comments/${commentId}/unresolve`, {}, UnresolveCommentResponse),

  deleteComment: (commentId: string) =>
    request('DELETE', `/api/comments/${commentId}`, undefined, DeleteCommentResponse),

  createReply: (commentId: string, input: z.input<typeof CreateReplyRequest>) =>
    request('POST', `/api/comments/${commentId}/replies`, input, CreateReplyResponse),

  approveThread: (threadId: string) =>
    request('POST', `/api/threads/${threadId}/approve`, {}, ApproveThreadResponse),

  reopenThread: (threadId: string) =>
    request('POST', `/api/threads/${threadId}/reopen`, {}, ReopenThreadResponse),

  deleteThread: (threadId: string) =>
    request('DELETE', `/api/threads/${threadId}`, undefined, DeleteThreadResponse),

  updateThread: (threadId: string, input: z.infer<typeof UpdateThreadRequest>) =>
    request('PATCH', `/api/threads/${encodeURIComponent(threadId)}`, input, UpdateThreadResponse),

  postDiscussionMessage: (
    threadId: string,
    input: z.input<typeof CreateDiscussionMessageRequest>,
  ) =>
    request(
      'POST',
      `/api/threads/${threadId}/discussion/messages`,
      input,
      CreateDiscussionMessageResponse,
    ),

  initAttachment: (threadId: string, input: z.input<typeof InitAttachmentInput>) =>
    request('POST', `/api/threads/${threadId}/attachments/init`, input, InitAttachmentResult),

  updateWorkspace: (input: { name?: string }) =>
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
};
