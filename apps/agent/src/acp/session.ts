import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Readable, Writable } from 'node:stream';
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
} from '@agentclientprotocol/sdk';
import type { ThreadId, UIMessageChunk } from '@tempo/contracts';
import { TEMPO_AGENT_SYSTEM_PROMPT } from '@tempo/contracts/agent-prompt';
import type { AgentEventRequest } from '@tempo/contracts/http';
import { postAgentChunks, postLifecycleEvent } from '../lifecycle';
import { logger } from '../logger';
import { ADAPTER_KILL_GRACE_MS, DISALLOWED_TOOLS, MAX_THINKING_TOKENS } from './config';
import { NotificationMapper } from './notifications';

const requireFromHere = createRequire(import.meta.url);

export interface AcpSessionOpts {
  threadId: ThreadId;
  cwd: string;
  workerUrl: string;
  token: string;
  // Optional adapter override — defaults to the bundled @agentclientprotocol/claude-agent-acp.
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
  // The active turn id — set for the duration of one prompt(), read by the
  // sessionUpdate callback to tag this turn's chunks. The persisted message and
  // its live frames share this id.
  private turn: string | null = null;
  // Serializes every Worker POST. The ACP connection may dispatch sessionUpdate
  // callbacks concurrently, so without this two batches could land out of order
  // and scramble the assembly buffer.
  private postChain: Promise<void> = Promise.resolve();
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
    logger.info('acp: starting new session (handshake + newSession)');
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
        systemPrompt: { append: TEMPO_AGENT_SYSTEM_PROMPT },
        // Edit/Write mutate user code — the system prompt forbids touching the
        // working directory (the Plan is the only writeable output). Enforce
        // architecturally so a drifted or injection-prompted model can't reach
        // for them. Bash and WebFetch
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
    logger.info({ sessionId: this.sessionId }, 'acp: session ready');
  }

  // Send a single prompt and wait for the turn to settle.
  // Payload is the same JSON envelope the old `--print` flag carried.
  async prompt(payload: string): Promise<StopReason> {
    if (!this.sessionId) throw new Error('acp: prompt before start()');
    this.turn = `amsg_${crypto.randomUUID()}`;
    await this.postChunks(this.mapper.startTurn(this.turn));

    const prompt: ContentBlock[] = [{ type: 'text', text: payload }];
    const res = await this.conn.prompt({ sessionId: this.sessionId, prompt });

    // Close open parts + finalize the persisted message; agent_turn_ended is the
    // event-log turn boundary (drives getEventsSinceLastTurn), separate concern.
    await this.postChunks(this.mapper.endTurn(), true);
    await this.postEvent({ kind: 'agent_turn_ended' });
    this.turn = null;

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
        // Defensive: a mapper bug (or an ACP shape we don't model) must not crash
        // the Client handler — that would tear down the whole session.
        let chunks: UIMessageChunk[] = [];
        try {
          chunks = this.mapper.handle(params);
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'acp: mapper threw',
          );
          return;
        }
        await this.postChunks(chunks);
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

  // Append a POST to the serial chain so ordering survives concurrent dispatch.
  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.postChain.then(task, task);
    this.postChain = next.catch(() => undefined);
    return next;
  }

  private async postEvent(event: AgentEventRequest['event']): Promise<void> {
    await this.enqueue(() =>
      postLifecycleEvent({
        workerUrl: this.opts.workerUrl,
        token: this.opts.token,
        threadId: this.opts.threadId,
        event,
      }),
    );
  }

  private async postChunks(chunks: UIMessageChunk[], done = false): Promise<void> {
    const turn = this.turn;
    if (!turn) return;
    await this.enqueue(() =>
      postAgentChunks({
        workerUrl: this.opts.workerUrl,
        token: this.opts.token,
        threadId: this.opts.threadId,
        turn,
        chunks,
        done,
      }),
    );
  }
}

// Resolve the adapter to spawn. Default is the bundled claude-agent-acp:
// run its entry under the current Node binary so the published CLI
// works whether installed locally or globally.
function resolveAdapter(cmd?: string, args?: string[]): [string, string[]] {
  if (cmd) return [cmd, args ?? []];
  const entry = requireFromHere.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js');
  return [process.execPath, [entry, ...(args ?? [])]];
}
