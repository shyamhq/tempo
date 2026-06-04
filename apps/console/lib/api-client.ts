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
  ListSpacesResponse,
  ListSpaceThreadsResponse,
  ListThreadsResponse,
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
import type { z } from 'zod';

// Dev auth: single header for the MVP single-user Console.
const DEV_HEADERS: HeadersInit = {
  'Content-Type': 'application/json',
  'X-Tempo-Dev': '1',
};

async function baseUrl(): Promise<string> {
  if (typeof window !== 'undefined') return '';
  if (process.env.NEXT_PUBLIC_CONSOLE_URL) return process.env.NEXT_PUBLIC_CONSOLE_URL;
  // RSC fetches: derive the current request's origin so the dev port matches.
  const { headers } = await import('next/headers');
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  responseSchema: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(`${await baseUrl()}${path}`, {
    method,
    headers: DEV_HEADERS,
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

  createComment: (threadId: string, input: z.infer<typeof CreateCommentRequest>) =>
    request('POST', `/api/threads/${threadId}/comments`, input, CreateCommentResponse),

  resolveComment: (commentId: string) =>
    request('POST', `/api/comments/${commentId}/resolve`, {}, ResolveCommentResponse),

  unresolveComment: (commentId: string) =>
    request('POST', `/api/comments/${commentId}/unresolve`, {}, UnresolveCommentResponse),

  createReply: (commentId: string, input: z.infer<typeof CreateReplyRequest>) =>
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
    input: z.infer<typeof CreateDiscussionMessageRequest>,
  ) =>
    request(
      'POST',
      `/api/threads/${threadId}/discussion/messages`,
      input,
      CreateDiscussionMessageResponse,
    ),
};
