import type {
  ActivityStatus,
  CommentId,
  ConnectToken,
  EventId,
  QuestionInput,
  ReplyPayload,
  RoundId,
  SessionId,
  ThreadId,
} from '@tempo/contracts';
import {
  CreateDiscussionMessageResponse,
  CreateReplyResponse,
  CreateSessionResponse,
  EventsLongPollResponse,
  GetPlanResponse,
  OpenRoundResponse,
  SetActivityStatusResponse,
  WritePlanResponse,
} from '@tempo/contracts/http';
import { AttachOutput, GetClarificationAnswersOutput } from '@tempo/contracts/mcp';
import type { z } from 'zod';
import { AuthError, ContractError, HttpStatusError, NetworkError } from './errors';
import { logger } from './logger';

type Method = 'GET' | 'POST';

const RETRYABLE_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1000, 2000];

export class ConsoleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: ConnectToken,
  ) {}

  createSession(body: { repo_remote: string | null; repo_path: string }) {
    return this.send('POST', '/api/sessions', body, CreateSessionResponse);
  }

  async getInitialPrompt(sessionId: SessionId): Promise<string> {
    return this.sendText('GET', `/api/sessions/${sessionId}/initial-prompt`);
  }

  getSessionState(sessionId: SessionId) {
    return this.send('GET', `/api/sessions/${sessionId}/state`, null, AttachOutput);
  }

  setActivityStatus(sessionId: SessionId, status: ActivityStatus) {
    return this.send(
      'POST',
      `/api/sessions/${sessionId}/status`,
      status,
      SetActivityStatusResponse,
    );
  }

  getPlan(threadId: ThreadId) {
    return this.send('GET', `/api/threads/${threadId}/plan`, null, GetPlanResponse);
  }

  writePlan(threadId: ThreadId, markdown: string) {
    return this.send('POST', `/api/threads/${threadId}/plan`, { markdown }, WritePlanResponse);
  }

  openRound(threadId: ThreadId, questions: QuestionInput[]) {
    return this.send(
      'POST',
      `/api/threads/${threadId}/clarification-rounds`,
      { questions },
      OpenRoundResponse,
    );
  }

  getRoundAnswers(roundId: RoundId) {
    return this.send(
      'GET',
      `/api/clarification-rounds/${roundId}`,
      null,
      GetClarificationAnswersOutput,
    );
  }

  poll(threadId: ThreadId, cursor: EventId, waitSeconds = 25) {
    return this.send(
      'GET',
      `/api/threads/${threadId}/events?cursor=${encodeURIComponent(cursor)}&wait=${waitSeconds}`,
      null,
      EventsLongPollResponse,
    );
  }

  postReply(commentId: CommentId, payload: ReplyPayload) {
    return this.send(
      'POST',
      `/api/comments/${commentId}/replies`,
      { payload },
      CreateReplyResponse,
    );
  }

  postDiscussionMessage(threadId: ThreadId, text: string) {
    return this.send(
      'POST',
      `/api/threads/${threadId}/discussion/messages`,
      { text },
      CreateDiscussionMessageResponse,
    );
  }

  private async send<T>(
    method: Method,
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const raw = await this.fetchJson(method, url, body);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      logger.debug({ url, issues: parsed.error.issues }, 'contract validation failed');
      throw new ContractError(url, parsed.error);
    }
    return parsed.data;
  }

  private async sendText(method: Method, path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    return this.withRetries(url, async () => {
      const res = await fetch(url, { method, headers: this.headers() });
      if (!res.ok) throw await this.toHttpError(res, url);
      return res.text();
    });
  }

  private async fetchJson(method: Method, url: string, body: unknown): Promise<unknown> {
    return this.withRetries(url, async () => {
      const init: RequestInit = { method, headers: this.headers() };
      if (body !== null && body !== undefined) {
        (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await fetch(url, init);
      if (!res.ok) throw await this.toHttpError(res, url);
      if (res.status === 204) return {};
      return res.json();
    });
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
  }

  private async toHttpError(res: Response, url: string): Promise<Error> {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    if (res.status === 401 || res.status === 403) return new AuthError();
    return new HttpStatusError(res.status, url, body);
  }

  private async withRetries<T>(url: string, attempt: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < RETRYABLE_ATTEMPTS; i++) {
      try {
        return await attempt();
      } catch (err) {
        lastErr = err;
        if (!isNetworkError(err) || i === RETRYABLE_ATTEMPTS - 1) {
          if (isNetworkError(err)) throw new NetworkError(url, err);
          throw err;
        }
        const delay = RETRY_DELAYS_MS[i] ?? 2000;
        logger.debug({ url, attempt: i + 1, delay }, 'retrying after network error');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new NetworkError(url, lastErr);
  }
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err instanceof HttpStatusError || err instanceof AuthError) return false;
  const code = (err as { code?: string }).code;
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ConnectionRefused' ||
    code === 'ConnectionClosed'
  ) {
    return true;
  }
  return (
    err.message.includes('fetch failed') ||
    err.message.includes('Unable to connect') ||
    err.name === 'TypeError'
  );
}
