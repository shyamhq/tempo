# Smoke-test checklist — comment anchor_block_id (deferred)

Implementation of plan `2026-06-08-comment-anchor-block-id.md` landed
T1–T5 on `feat/blocknote`. Static verification (typecheck, lint, sqlite
schema, repo-wide grep) is green. The runtime smoke-test was not run
overnight; the dev needs to drive it themselves with `bun run dev` and
a fresh thread.

**Note on migration 0014**: the SQL file was hand-crafted without
`drizzle-kit generate`, so `_journal.json` and
`meta/0014_snapshot.json` were absent — `db:migrate` would have silently
skipped it. Task 6 repaired this: snapshot and journal entry were added
and `db:migrate` applied the migration to the live DB successfully.
Future migrations should go through `drizzle-kit generate` to keep the
journal and snapshots in sync automatically.

## Steps

1. Start the Console: `bun run --filter @tempo/console dev`.
2. Open an existing thread (e.g. http://localhost:3000/threads/thr_01KTKEG5NN4KN21NSXB9HFJ59X).
3. **Create a new comment** by selecting some text in the plan and using the comment slash command (or whatever the Console's comment-creation affordance is).
4. **Verify `anchor_block_id` was persisted**:
   ```
   sqlite3 apps/console/data/tempo.db \
     "SELECT id, plan_quote, anchor_block_id FROM comments ORDER BY created_at DESC LIMIT 1;"
   ```
   The most recent row should have a non-null `anchor_block_id` (UUID-like string).
5. **Edit the anchored text but keep the block** — comment should stay anchored at the same line. Refresh the page; verify it still does.
6. **Delete the anchored text but keep the block** — comment's `comment` mark goes away. The gutter icon should now render at the *block's top* with dashed amber border + ✕ badge. Hover the icon to confirm the title says "Open (orphaned)" or similar.
7. **Delete the whole block** — comment should fall through to the footer-bucket layout at the bottom of the gutter, rendering with `MessageSquareOff` icon and the "ORPHANED" label visible.
8. **Multi-block selection test** — select text spanning a paragraph + a heading, create a comment. The `anchor_block_id` should be the FIRST block in the selection (the paragraph in this case). Verify by inspecting sqlite or by deleting the END block and confirming the orphan still lives on the START block.
9. **Refresh the page** in each of the three orphan states above. All states should survive a reload because positioning is computed from `anchor_block_id` stored in SQLite.

If any step fails, file the failure as a fresh issue against `feat/blocknote` and pause before merging.
