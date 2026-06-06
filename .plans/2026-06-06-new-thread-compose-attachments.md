# Image attachments in the new-thread compose surface

## Problem

The Discussion composer, NewCommentCard, and inline Reply composer all carry
the `+`-button + thumbnail tray + drag/drop/paste affordances delivered in the
attachments slice. `NewThreadCompose` (`apps/console/components/dashboard/
new-thread-compose.tsx`) — the "What do you want to plan?" page used to
create a Thread — does not. A Dev who wants to start a Thread from a
screenshot has to create the Thread first, then attach in the Discussion,
which breaks the "describe the change, in one shot" framing of the compose
surface and means the very first Agent turn already missed the image.

## The smallest concrete change

Add **paste + drag + click-to-pick** image attachments to `NewThreadCompose`
with the same visual shape used elsewhere (`+` icon bottom-left of the
textarea, square thumbnails above the textarea, X-to-remove, click-to-
preview via `Lightbox`).

Compose already runs two sequential mutations on submit (`createThread` →
`postDiscussionMessage`) — this plan adds a **third sequential step**
*inside that same submit handler*: between thread create and message post,
upload each pending file to R2 via the existing `init` + `PUT` pair, then
include the resulting `attachment_id`s in the first Discussion Message.

Local state in `NewThreadCompose`:

```ts
type Pending = {
  clientId: string;     // React key + tray identity
  file: File;
  localUrl: string;     // blob: URL for the local thumbnail preview
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLen: number;
};
const [pending, setPending] = useState<Pending[]>([]);
```

No server traffic on attach. Bytes only leave the browser at submit time.

## Why not reuse `useAttachmentUploader`

The existing hook calls `api.initAttachment(threadId, …)` synchronously
inside `addFiles`. The compose surface has no `threadId` until the very
moment of submit. Two ways to bridge:

1. **Refactor the hook** to accept `threadId: string | (() => Promise<string>)`,
   create the Thread lazily on first attach inside the resolver.
2. **Don't reuse the hook**; hold local `Pending[]` state in compose and
   call `init` + `PUT` directly inside the existing `submit` handler.

Option 2 keeps the optimistic-upload hook simple (it's used by three other
sites that all have a real `threadId`), avoids introducing a "Thread that
exists because the Dev attached a file but never typed text" orphan, and
the compose surface is the only caller that needs deferred upload —
locality wins. Option 1 would add a seam for one caller, violating the
"one adapter is hypothetical" rule. **Choose 2.**

## Why reuse `<AttachmentThumbnails>` etc.

The split done in the attachments slice (`useAttachmentSurface` +
`<AttachmentThumbnails>` + `<AttachmentAddButton>` + `<AttachmentDrag-
Overlay>`) was already designed to compose freely per layout. They consume
an `Uploader` value defined at
`apps/console/components/thread/attachments/attachment-tray.tsx:20` as
`type Uploader = ReturnType<typeof useAttachmentUploader>`, which expands
to:

```ts
{
  items: PendingAttachment[];              // see use-attachment-uploader.ts:12
  addFiles: (files: File[]) => Promise<void>;
  remove: (id: string) => void;
  reset: () => void;
  readyIds: string[];
  allReady: boolean;
  hasUploading: boolean;
}
```

`PendingAttachment` itself requires fields the compose-local state doesn't
have a meaningful value for (`serverId: string | null`,
`status: 'uploading' | 'ready' | 'error'`, optional `error: string`).

**Approach:** keep the compose-local state lean (`Pending` as described
above — no `serverId`, no `status`), and at the call sites for the
sub-components, project `Pending[]` → `PendingAttachment[]` inside the
inline shim object literal. The shim:

```ts
const shim = {
  items: pending.map(
    (p): PendingAttachment => ({
      clientId: p.clientId,
      serverId: null,
      file: p.file,
      localUrl: p.localUrl,
      mime: p.mime,
      byteLen: p.byteLen,
      status: 'ready' as const,            // not literally uploading; suppresses spinner
    }),
  ),
  addFiles: addPending,
  remove: removePending,
  reset: () => setPending([]),
  readyIds: [],
  allReady: false,
  hasUploading: false,
};
```

`status: 'ready'` is the right value visually — the bytes are *ready in the
browser*, just not on the server yet. `<AttachmentThumbnails>` renders a
spinner overlay only when `status === 'uploading'` and a `failed` badge
when `'error'`; `'ready'` renders a clean thumbnail, which is what we
want.

The components don't read `readyIds`, `allReady`, `hasUploading`, or
`reset` themselves — those are part of the published shape for *composers*
to consume, and compose tracks them locally via `pending.length` instead.
Setting safe-default values still satisfies the type checker.

Conclusion: reuse `<AttachmentThumbnails>` and `<AttachmentAddButton>` and
`useAttachmentSurface` (paste + drop wiring) and `<AttachmentDragOverlay>`.
Do not introduce a new component.

## Alternatives considered

- **Refactor `useAttachmentUploader` to accept `() => Promise<threadId>`.**
  Rejected — one caller needs it, the hook stays simple; the only
  cleanup would be a tighter type story, which doesn't beat the duplication
  cost.
- **Create the Thread eagerly when the user clicks `+` for the first time
  and use the existing uploader hook unchanged.** Rejected — produces an
  orphan Thread for every Dev who pastes an image then walks away or
  closes the tab. Tempo already has the AGENTS.md "Spotted but not fixed"
  note about the two-mutation compose orphan; making it three would
  widen the same problem.
- **Hide the `+` button until the Dev has typed text.** Rejected —
  pointless friction; the order of attaching vs. typing doesn't matter.

## Verified contract points

- `PostDiscussionMessageInput` (re-exported as `CreateDiscussionMessageRequest`
  via `packages/contracts/src/http.ts:195`) carries
  `attachments: z.array(AttachmentId).max(8).default([])` —
  `packages/contracts/src/mcp.ts:75`. `api.postDiscussionMessage` types
  its input via `z.input<typeof CreateDiscussionMessageRequest>`
  (`apps/console/lib/api-client.ts:143`), so passing an `attachments`
  array of server ids works through the typed client without further
  contract work.
- `api.initAttachment(threadId, { mime, byte_len })` returns
  `{ id, put_url, expires_at }` (`InitAttachmentResult` in
  `packages/contracts/src/http.ts:121`); the client PUTs raw bytes with
  `Content-Type: <mime>` to `put_url` directly against R2/MinIO. The
  Console's `verifyAttachmentsInR2` then HEADs the object inside the
  message-create transaction (`apps/console/server/discussion.ts:46`).

## Uncertainties

- **Order of operations on submit when uploads fail mid-batch.** If
  `createThread` succeeds and one of N uploads fails, we have a Thread
  but no message and no attachments. Same shape as the existing two-step
  orphan; surfaced as an error toast, the Dev retries. Document the
  failure mode in the inline comment so the next reader doesn't add a
  rollback that creates a different bug.
- **`postDiscussionMessage` requires `text` *or* attachments-or-questions.**
  The contract was extended in the attachments slice to accept attachments-
  only messages. Compose currently requires `trimmed.length > 0` for the
  Start button to enable; this plan keeps that requirement (a text-less
  thread title is bad UX even if the first message has an image) — the
  text field remains the gate. Attachments are optional add-ons to a text
  message.

## Layer placement

- All new code lives in `apps/console/components/dashboard/new-thread-
  compose.tsx`. No server-domain change. No new files. No new HTTP routes.

## File responsibility

`new-thread-compose.tsx` already owns the compose-state machine
(`Phase`, `text`, `error`) and the network mutations. Adding `pending: Pending[]`
and an upload pass inside `submit` is in scope. No other file changes.

## Deletion test

The only addition is a few dozen lines of UI state + UI markup in
`new-thread-compose.tsx`. If you delete the `pending` state and the
attachment-related UI, the compose surface loses image upload but the rest
of the page is unchanged. No new modules, no new hooks, no new components,
no new tunables — so the deletion test is trivially satisfied.

## Modified files

- `apps/console/components/dashboard/new-thread-compose.tsx` — add
  `Pending[]` state, wire `<AttachmentThumbnails>` + `<AttachmentAddButton>`
  + `useAttachmentSurface` + `<AttachmentDragOverlay>` via a thin shim
  object that satisfies the `Uploader` interface, and extend the existing
  `submit` handler with an upload pass between `createThread` and
  `postDiscussionMessage`.

## New files

- None.

## Destructive actions

- None.

## Out of scope

- Refactoring `useAttachmentUploader` for deferred-thread cases.
- Re-using the lazy-create pattern anywhere else (handoff, etc.).
- Surfacing per-file upload errors during the submit pass beyond the
  existing `error` toast — sequential and all-or-nothing for v1.
