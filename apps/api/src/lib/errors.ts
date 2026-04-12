export class NotFoundError extends Error {
  override readonly name = 'NotFoundError' as const;
  constructor(message = 'Resource not found') {
    super(message);
  }
}

export class ForbiddenError extends Error {
  override readonly name = 'ForbiddenError' as const;
  constructor(message = 'Forbidden') {
    super(message);
  }
}

export class ValidationError extends Error {
  override readonly name = 'ValidationError' as const;
  public readonly details: unknown;
  constructor(message = 'Validation failed', details?: unknown) {
    super(message);
    this.details = details;
  }
}

export class RateLimitError extends Error {
  override readonly name = 'RateLimitError' as const;
  constructor(message = 'Too many requests') {
    super(message);
  }
}

export class ScanError extends Error {
  override readonly name = 'ScanError' as const;
  constructor(message = 'Scan error') {
    super(message);
  }
}
