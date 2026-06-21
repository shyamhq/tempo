'use client';

// The comments feature's single seam into the BlockNote editor. The plan editor
// (which owns useCreateBlockNote) calls this hook and splices the returned
// extension into its `extensions` array; everything comment-specific — the
// CommentThreadStore (reads the comments slice, writes via api.ts), resolveUsers
// (Clerk member display + the Agent sentinel), and the anchor capture — lives
// here, so the plan feature holds no comment knowledge.
//
// The extension instance is stable for the life of the thread: BlockNote
// captures threadStore + resolveUsers at editor construction, so they must not
// change identity. Auth/members are read through refs, so Clerk hydrating the
// session never rebuilds the store (which would churn comment subscribers).

import type { User } from '@blocknote/core/comments';
import { CommentsExtension } from '@blocknote/core/comments';
import type { useCreateBlockNote } from '@blocknote/react';
import { useAuth, useOrganization } from '@clerk/nextjs';
import { type RefObject, useCallback, useMemo, useRef } from 'react';
import { AGENT_AUTHOR_ID, CommentThreadStore } from './comment-thread-store';
import { readAnchor } from './read-anchor';

type OrgMembers = NonNullable<ReturnType<typeof useOrganization>['memberships']>['data'];

// Map a comment author id to a BlockNote User. The Agent sentinel renders as
// "Agent"; a Clerk user id resolves to the member's display name (falling back
// to the identifier, then the raw id) from the active org's membership list.
function resolveAuthorUser(id: string, members: OrgMembers | null | undefined): User {
  if (id === AGENT_AUTHOR_ID) return { id, username: 'Agent', avatarUrl: '' };
  const pub = members?.find((m) => m.publicUserData?.userId === id)?.publicUserData;
  if (!pub) return { id, username: id, avatarUrl: '' };
  const name = `${pub.firstName ?? ''} ${pub.lastName ?? ''}`.trim();
  return { id, username: name || pub.identifier || id, avatarUrl: pub.imageUrl ?? '' };
}

type Editor = ReturnType<typeof useCreateBlockNote>;

export function useCommentsExtension(
  threadId: string,
  // The live editor, owned by the plan editor (assigned right after creation).
  // captureAnchor reads its PM selection at the instant createThread fires.
  editorRef: RefObject<Editor | null>,
): ReturnType<typeof CommentsExtension> {
  const { getToken, userId } = useAuth();
  const { memberships } = useOrganization({ memberships: true });

  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const membersRef = useRef(memberships?.data);
  membersRef.current = memberships?.data;
  // The connected Dev id: the ThreadStoreAuth subject + the author of optimistic
  // resolves. Read through a ref so Clerk hydrating (userId null → id) doesn't
  // rebuild the store. Falls back to the Agent sentinel only pre-hydration — the
  // route is auth-gated.
  const devUserIdRef = useRef(userId ?? AGENT_AUTHOR_ID);
  devUserIdRef.current = userId ?? AGENT_AUTHOR_ID;

  const threadStore = useMemo(
    () =>
      new CommentThreadStore({
        threadId,
        getDevUserId: () => devUserIdRef.current,
        getToken: () => getTokenRef.current(),
        captureAnchor: () => readAnchor(editorRef.current),
      }),
    [threadId, editorRef],
  );

  const resolveUsers = useCallback(
    (userIds: string[]): Promise<User[]> =>
      Promise.resolve(userIds.map((id) => resolveAuthorUser(id, membersRef.current))),
    [],
  );

  return useMemo(
    () => CommentsExtension({ threadStore, resolveUsers }),
    [threadStore, resolveUsers],
  );
}
