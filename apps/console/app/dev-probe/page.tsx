'use client';

// T2.3 dev probe — spartan, removed at cutover. Proves the state-core loop:
// hydration seeds the slices, and the optimistic-write → server-echo → gateway
// dedup path reconciles to a single copy.
//
// Drive it: /dev-probe?thread=<threadId>. The comment list renders from the
// comments slice (seeded by hydrate, kept live by the gateway). The composer
// creates a comment via the Worker, writes the returned entity into the slice
// immediately, and the gateway dedups the comment_added SSE echo by id. The
// reply composer does the same for the first comment via reply_added.

import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { createComment, createReply } from '../../features/comments/api';
import { useThreadSession } from '../../hooks/useThreadSession';
import { useComments, useThreadStore } from '../../store';

export default function DevProbePage() {
  // useSearchParams needs a Suspense boundary (Next App Router).
  return (
    <Suspense fallback={null}>
      <ProbeFromQuery />
    </Suspense>
  );
}

function ProbeFromQuery() {
  const threadId = useSearchParams().get('thread') ?? '';
  if (!threadId) {
    return <p style={{ padding: 16 }}>Add ?thread=&lt;threadId&gt; to the URL.</p>;
  }
  return <Probe threadId={threadId} />;
}

function Probe({ threadId }: { threadId: string }) {
  useThreadSession(threadId);
  const comments = useComments();
  const { getToken } = useAuth();
  const [commentText, setCommentText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);

  async function onAddComment() {
    if (!commentText.trim() || busy) return;
    setBusy(true);
    try {
      // Optimistic: write the server-returned entity into the slice on POST
      // resolve; the comment_added SSE echo dedups by id (addCommentLocal upsert).
      const created = await createComment(
        threadId,
        {
          plan_quote: 'dev-probe',
          plan_context: 'dev-probe',
          anchor_block_id: null,
          first_reply_text: commentText.trim(),
          attachments: [],
        },
        getToken,
      );
      useThreadStore.getState().addCommentLocal(created);
      setCommentText('');
    } finally {
      setBusy(false);
    }
  }

  async function onAddReply() {
    const target = comments[0];
    if (!target || !replyText.trim() || busy) return;
    setBusy(true);
    try {
      const reply = await createReply(
        target.id,
        { payload: { text: replyText.trim() }, attachments: [] },
        getToken,
      );
      useThreadStore.getState().addReplyLocal(target.id, reply);
      setReplyText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'monospace', maxWidth: 720 }}>
      <h1>dev-probe — {threadId}</h1>

      <h2>comments ({comments.length})</h2>
      <ul>
        {comments.map((c) => (
          <li key={c.id} style={{ marginBottom: 8 }}>
            <div>
              <strong>{c.id}</strong> — author: {c.author_user_id ?? 'agent'} — quote:{' '}
              {c.plan_quote}
            </div>
            <ul>
              {c.replies.map((r) => (
                <li key={r.id}>
                  reply {r.id} ({r.author_user_id ?? 'agent'}): {r.payload.text}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <h2>add comment</h2>
      <input
        value={commentText}
        onChange={(e) => setCommentText(e.target.value)}
        placeholder="comment text"
        style={{ width: '70%' }}
      />
      <button type="button" onClick={onAddComment} disabled={busy}>
        add comment
      </button>

      <h2>add reply (to first comment)</h2>
      <input
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        placeholder="reply text"
        style={{ width: '70%' }}
      />
      <button type="button" onClick={onAddReply} disabled={busy}>
        add reply
      </button>
    </div>
  );
}
