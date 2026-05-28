export class TempoError extends Error {
  constructor(
    message: string,
    readonly tempoCause?: unknown,
  ) {
    super(message);
    this.name = 'TempoError';
  }
}

export class AuthError extends TempoError {
  constructor(message = 'token rejected by Console') {
    super(message);
    this.name = 'AuthError';
  }
}

export class NetworkError extends TempoError {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(`could not reach ${url}: ${describe(cause)}`, cause);
    this.name = 'NetworkError';
  }
}

export class HttpStatusError extends TempoError {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: unknown,
  ) {
    super(`${status} from ${url}${bodyHint(body)}`);
    this.name = 'HttpStatusError';
  }
}

export class ContractError extends TempoError {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(`Console response for ${url} did not match contract`, cause);
    this.name = 'ContractError';
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

function bodyHint(body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return ` — ${m}`;
  }
  return '';
}

export function toDevMessage(err: unknown): string {
  if (err instanceof AuthError)
    return `failed: ${err.message}. Re-copy the connect command from the Thread page.`;
  if (err instanceof NetworkError) return `failed: ${err.message}. Is the Console running?`;
  if (err instanceof HttpStatusError) {
    if (err.status === 404)
      return `failed: Console route ${err.url} not found — Console version mismatch?`;
    if (err.status === 409) return `failed: ${err.message}`;
    return `failed: ${err.message}`;
  }
  if (err instanceof ContractError)
    return `failed: ${err.message}. Console and CLI versions may be out of sync.`;
  if (err instanceof TempoError) return `failed: ${err.message}`;
  if (err instanceof Error) return `failed: ${err.message}`;
  return `failed: ${String(err)}`;
}
