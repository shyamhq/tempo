import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Readable, Writable } from 'node:stream';
import type { ThreadId } from '@tempo/contracts';
import type { AgentEventRequest } from '@tempo/contracts/http';
import {
  type Client,
  ClientSideConnection,
  type ContentBlock,
  type McpServer,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@zed-industries/agent-client-protocol';
import { postLifecycleEvent } from '../lifecycle';
import { logger } from '../logger';
import { ADAPTER_KILL_GRACE_MS, DISALLOWED_TOOLS, MAX_THINKING_TOKENS } from './config';
import { NotificationMapper } from './notifications';
import { TEMPO_SYSTEM_PROMPT_APPEND } from './system-prompt';

const requireFromHere = createRequire(import.meta.url);

export interface AcpSessionOpts {
  threadId: ThreadId;
  cwd: string;
  workerUrl: string;
  token: string;
  // Optional adapter override — defaults to the bundled @zed-industries/claude-code-acp.
  adapterCmd?: string;
  adapterArgs?: string[];
}

export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

// One persistent ACP session for the lifetime of a `tempo-agent connect`.
// Owns the adapter subprocess, the ACP connection, and the streamed event
// fan-out to Worker. Replaces the previous spawn-per-turn `runTurn` model.
export class AcpSession {
  private child: ChildProcess;
  private conn: ClientSideConnection;
  private sessionId: string | null = null;
  private mapper = new NotificationMapper();
  private closed = false;
  private exited: Promise<number | null>;

  constructor(private readonly opts: AcpSessionOpts) {
    const [cmd, args] = resolveAdapter(opts.adapterCmd, opts.adapterArgs);
    logger.debug({ cmd, args }, 'acp: spawning adapter');

    this.child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env },
    });

    this.exited = new Promise((resolve) => {
      this.child.once('exit', (code) => resolve(code));
    });

    const stdin = this.child.stdin;
    const stdout = this.child.stdout;
    if (!stdin || !stdout) throw new Error('acp: adapter stdio pipes unavailable');

    const stream = ndJsonStream(
      Writable.toWeb(stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(stdout) as ReadableStream<Uint8Array>,
    );

    this.conn = new ClientSideConnection(() => this.clientImpl(), stream);
  }

  // Handshake + create the conversation session. Returns once the adapter
  // has spun up its inner Claude Code SDK and is ready to receive prompts.
  async start(): Promise<void> {
    const init = await this.conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        // The wrapped Claude reads/writes its own filesystem inside the adapter
        // process — we don't proxy fs through ACP. Terminal: same.
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    logger.debug({ protocolVersion: init.protocolVersion }, 'acp: initialized');

    const session = await this.conn.newSession({
      cwd: this.opts.cwd,
      mcpServers: [this.tempoMcpServer()],
      _meta: {
        systemPrompt: { append: TEMPO_SYSTEM_PROMPT_APPEND },
        // Edit/Write mutate user code — explicitly forbidden by §Identity in
        // the system prompt. Enforce architecturally so a drifted or
        // injection-prompted model can't reach for them. Bash and WebFetch
        // stay allowed — the Agent uses them to fetch docs, search GitHub,
        // and inspect the repo during exploration.
        claudeCode: {
          options: {
            disallowedTools: [...DISALLOWED_TOOLS],
            maxThinkingTokens: MAX_THINKING_TOKENS,
          },
        },
      },
    });
    this.sessionId = session.sessionId;
    logger.debug({ sessionId: this.sessionId }, 'acp: session created');
  }

  // Send a single prompt and wait for the turn to settle.
  // Payload is the same JSON envelope the old `--print` flag carried.
  async prompt(payload: string): Promise<StopReason> {
    if (!this.sessionId) throw new Error('acp: prompt before start()');
    const prompt: ContentBlock[] = [{ type: 'text', text: payload }];
    const res = await this.conn.prompt({ sessionId: this.sessionId, prompt });

    // Flush any narration/thought left buffered at turn end.
    for (const event of this.mapper.flushText()) await this.postEvent(event);
    await this.postEvent({ kind: 'agent_turn_ended' });

    return res.stopReason;
  }

  // Cooperative cancel — adapter resolves the in-flight prompt with
  // stopReason 'cancelled'. Always pair with close() for full teardown.
  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    await this.conn.cancel({ sessionId: this.sessionId });
  }

  // The adapter subprocess is still running and we haven't torn it down.
  // Use this after a prompt failure to decide between strike-counting (live
  // adapter, real LLM/network failure) and respawning (adapter crashed).
  isAlive(): boolean {
    return !this.closed && !this.child.killed && this.child.exitCode === null;
  }

  // Tear down the adapter subprocess.
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.child.killed) {
      this.child.kill('SIGINT');
      const force = setTimeout(() => this.child.kill('SIGKILL'), ADAPTER_KILL_GRACE_MS);
      force.unref();
    }
    await this.exited.catch(() => null);
  }

  // The Client side of the ACP wire — handlers the adapter calls back into.
  private clientImpl(): Client {
    return {
      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        // Defensive: a bug in the mapper (or an ACP shape we don't model)
        // must not crash the Client handler — that would tear the whole session.
        let events: AgentEventRequest['event'][] = [];
        try {
          events = this.mapper.handle(params);
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'acp: mapper threw',
          );
          return;
        }
        for (const event of events) await this.postEvent(event);
      },
      requestPermission: async (
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> => {
        // ponytail: auto-approve, but log every approval so there's an audit
        // trail even before a real approve seam lands in the Console. The
        // disallowedTools list in newSession blocks Edit/Write/Bash/WebFetch
        // architecturally; this only sees MCP + read/search-style tools.
        const tc = params.toolCall;
        logger.warn(
          { toolCallId: tc.toolCallId, kind: tc.kind, title: tc.title?.slice(0, 100) },
          'acp: auto-approving tool call',
        );
        const allow = params.options.find((o) => o.kind === 'allow_once') ?? params.options[0];
        if (!allow) {
          return { outcome: { outcome: 'cancelled' } };
        }
        return { outcome: { outcome: 'selected', optionId: allow.optionId } };
      },
      // fs.* and terminal.* are optional on Client — omitted here because we
      // advertised no fs/terminal capability during initialize().
    };
  }

  private tempoMcpServer(): McpServer {
    return {
      type: 'http',
      name: 'tempo',
      url: `${this.opts.workerUrl}/mcp`,
      headers: [
        { name: 'Authorization', value: `Bearer ${this.opts.token}` },
        { name: 'X-Tempo-Thread-Id', value: this.opts.threadId },
      ],
    };
  }

  private async postEvent(event: AgentEventRequest['event']): Promise<void> {
    await postLifecycleEvent({
      workerUrl: this.opts.workerUrl,
      token: this.opts.token,
      threadId: this.opts.threadId,
      event,
    });
  }
}

// Resolve the adapter to spawn. Default is the bundled claude-code-acp:
// run its CJS entry under the current Node binary so the published CLI
// works whether installed locally or globally.
function resolveAdapter(cmd?: string, args?: string[]): [string, string[]] {
  if (cmd) return [cmd, args ?? []];
  const entry = requireFromHere.resolve('@zed-industries/claude-code-acp/dist/index.js');
  return [process.execPath, [entry, ...(args ?? [])]];
}
