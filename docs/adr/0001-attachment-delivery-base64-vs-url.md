# ADR 0001 — Attachment delivery to Claude: MCP base64 image blocks (v1)

**Status:** Accepted, 2026-06-06
**Decision driver:** Decision #14 in the image-upload plan (`.plans/…`).
**Decision:** Deliver attachment images to Claude via MCP-native `image` content blocks, base64-encoded by the Agent CLI from R2 GET bytes.

## Context

`tempo_attach` and `tempo_poll` return JSON state to Claude. With attachments added, Claude also needs to see the *pixels* — descriptions ("dev sent a screenshot") are useless for actual vision tasks. The MCP SDK supports two delivery shapes:

1. **`image` content block** (base64-encoded data + mime type). MCP-native. The SDK round-trips it as a tool-result content item.
2. **URL injection via the Anthropic SDK wrapper.** Pre-process tool-result JSON in the Agent CLI's SDK driver, extract attachment URLs, rewrite them into Anthropic `image` content blocks with `source.type = 'url'`. Custom plumbing per driver (`pty` and `stream-json` would each need rewriting hooks).

## Decision

Use form (1) for v1. The Agent CLI fetches the signed R2 GET URL (`apps/agent/src/r2-fetcher.ts`), base64-encodes the bytes, and emits an MCP `image` content block alongside the existing `text` block in `tempo_attach` and `tempo_poll`.

## Why now

- **One code path.** The MCP SDK already routes `image` content blocks through to Claude as vision content; we don't have to thread image-rewriting through every driver.
- **Existing seam.** `tempo_attach` and `tempo_poll` already wrap a JSON payload — adding a sibling content block is a 3-line change to the `wrap` helper.
- **Latency is acceptable.** Recent-N inlining bounds the bytes per `tempo_attach` call (default N=5 messages, 8 files/message, 10MB/file → 400MB worst-case, ~few MB typical). `tempo_poll` images are per-event, sized by the live message.

## Costs / trade-offs

- **Token-budget cost.** Anthropic charges per image regardless of delivery shape. URL-form would be identical here; base64 wins nothing on cost.
- **Bytes on the wire.** Base64 inflates payload ~33%. With recent-N=5 and typical screenshots, this is rarely > 2 MB per `tempo_attach` call — fine for local stdio MCP transport.
- **No URL caching.** If the same image arrives twice (replay after compact), it gets re-fetched + re-encoded both times. URL-form would let Anthropic cache. Not a concern at MVP volume.

## Revisit triggers (switch to URL-form when any one fires)

1. **Console deploys behind R2 in production** and `tempo_attach`'s base64 payload regularly exceeds ~5 MB per call (measure via `tempo_attach` response length log).
2. **Agent CLI ships as a packaged binary** where the round-trip latency of fetching R2 bytes + re-encoding becomes a Dev-visible delay on cold attach.
3. **Anthropic introduces per-tool-result vision caching** for URL-form image blocks (i.e. caching becomes the cheap path).
4. **A second consumer beyond Claude** wants the same MCP tool surface (e.g. a Codex-style runner that accepts URL-form). One adapter is still hypothetical; two would make URL-form the right shape.

If a trigger fires: redesign S4 along the plan's fallback (text marker emitted by the Agent CLI's MCP server, rewritten into Claude `image` content blocks by a thin SDK driver shim before the Anthropic API call).

## Out of scope (for v1)

- Per-MIME re-encoding (e.g. transcoding webp→png if Claude rejects it).
- Image resizing to stay under per-image token caps.
- Anthropic's `prompt-caching` for vision content (no API exposure yet at decision time).
