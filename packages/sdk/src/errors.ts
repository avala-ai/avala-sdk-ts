export class AvalaError extends Error {
  public readonly statusCode: number | undefined;
  public readonly body: unknown;

  constructor(message: string, statusCode?: number, body?: unknown) {
    super(message);
    this.name = "AvalaError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export class AuthenticationError extends AvalaError {
  constructor(message: string, body?: unknown) {
    super(message, 401, body);
    this.name = "AuthenticationError";
  }
}

export class NotFoundError extends AvalaError {
  constructor(message: string, body?: unknown) {
    super(message, 404, body);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AvalaError {
  public readonly retryAfter: number | null;

  constructor(message: string, body?: unknown, retryAfter?: number | null) {
    super(message, 429, body);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter ?? null;
  }
}

export class ValidationError extends AvalaError {
  public readonly details: unknown[];

  constructor(message: string, statusCode: number = 400, body?: unknown, details?: unknown[]) {
    super(message, statusCode, body);
    this.name = "ValidationError";
    this.details = details ?? [];
  }
}

export class ServerError extends AvalaError {
  constructor(message: string, statusCode: number, body?: unknown) {
    super(message, statusCode, body);
    this.name = "ServerError";
  }
}
