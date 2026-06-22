// Sidebar feature client: typed reads/writes for the spaces/threads tree over
// the Console-side routes via lib/api-client. Components never call these — slice
// actions do (the action calls api.ts, which uses shared lib/api-client). The
// tree GET seeds the slice on shell mount; the mutations re-seed the affected
// space or edit the tree in place.

import { Space, SpaceThreadLite } from '@tempo/contracts';
import {
  CreateSpaceResponse,
  type UpdateSpaceRequest,
  type UpdateThreadRequest,
} from '@tempo/contracts/http';
import { z } from 'zod';
import { request } from '../../lib/api-client';

// GET /api/spaces returns the whole rail in one pass. threadsBySpace is keyed by
// SpaceId; the route guarantees a key per space (empty array for empty spaces).
const SpaceTreeResponse = z.object({
  spaces: z.array(Space),
  threadsBySpace: z.record(z.string(), z.array(SpaceThreadLite)),
});
export type SpaceTree = z.infer<typeof SpaceTreeResponse>;

const OkResponse = z.object({ ok: z.literal(true) });

export function getSpaces(): Promise<SpaceTree> {
  return request('GET', '/api/spaces', undefined, SpaceTreeResponse);
}

export function createSpace(name: string): Promise<Space> {
  return request('POST', '/api/spaces', { name }, CreateSpaceResponse).then((r) => r.space);
}

export function updateSpace(
  spaceId: string,
  input: z.input<typeof UpdateSpaceRequest>,
): Promise<void> {
  return request('PATCH', `/api/spaces/${encodeURIComponent(spaceId)}`, input, OkResponse).then(
    () => undefined,
  );
}

export function deleteSpace(spaceId: string): Promise<void> {
  return request(
    'DELETE',
    `/api/spaces/${encodeURIComponent(spaceId)}`,
    undefined,
    OkResponse,
  ).then(() => undefined);
}

export function updateThread(
  threadId: string,
  input: z.input<typeof UpdateThreadRequest>,
): Promise<void> {
  return request(
    'PATCH',
    `/api/threads/${encodeURIComponent(threadId)}`,
    input,
    z.object({ thread: z.unknown() }),
  ).then(() => undefined);
}

export function deleteThread(threadId: string): Promise<void> {
  return request(
    'DELETE',
    `/api/threads/${encodeURIComponent(threadId)}`,
    undefined,
    OkResponse,
  ).then(() => undefined);
}
