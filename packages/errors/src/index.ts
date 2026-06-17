export class TempoError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends TempoError {
  constructor(message = 'not found', options?: { cause?: unknown }) {
    super('not_found', 404, message, options);
  }
}

export class UnauthorizedError extends TempoError {
  constructor(message = 'unauthorized', options?: { cause?: unknown }) {
    super('unauthorized', 401, message, options);
  }
}

export class ForbiddenError extends TempoError {
  constructor(message = 'forbidden', options?: { cause?: unknown }) {
    super('forbidden', 403, message, options);
  }
}

export class ConflictError extends TempoError {
  constructor(message = 'conflict', options?: { cause?: unknown }) {
    super('conflict', 409, message, options);
  }
}

export class ValidationError extends TempoError {
  constructor(message = 'validation failed', options?: { cause?: unknown }) {
    super('invalid_input', 400, message, options);
  }
}

export class InternalError extends TempoError {
  constructor(message = 'internal_error', options?: { cause?: unknown }) {
    super('internal_error', 500, message, options);
  }
}
