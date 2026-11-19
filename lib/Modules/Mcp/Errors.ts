export class McpAuthenticationError extends Error {
  readonly code = "UNAUTHENTICATED";
  readonly status = 401;

  constructor() {
    super("MCP authentication failed");
    this.name = "McpAuthenticationError";
  }
}

export class McpAuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  readonly status = 403;

  constructor(message = "MCP scope is not granted") {
    super(message);
    this.name = "McpAuthorizationError";
  }
}

/** Retorna falhas de entrada como erro de domínio, não como exceção genérica. */
export class McpValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly status = 400;

  constructor(message = "MCP input validation failed") {
    super(message);
    this.name = "McpValidationError";
  }
}

export class McpPayloadTooLargeError extends Error {
  readonly code = "PAYLOAD_TOO_LARGE";
  readonly status = 413;

  constructor(message = "MCP request body too large") {
    super(message);
    this.name = "McpPayloadTooLargeError";
  }
}

export class McpRateLimitError extends Error {
  readonly code = "RATE_LIMITED";
  readonly status = 429;

  constructor() {
    super("MCP rate limit exceeded");
    this.name = "McpRateLimitError";
  }
}

export class McpRateLimitUnavailableError extends Error {
  readonly code = "MCP_RATE_LIMIT_UNAVAILABLE";
  readonly status = 503;

  constructor() {
    super("MCP rate limiting is temporarily unavailable");
    this.name = "McpRateLimitUnavailableError";
  }
}

export class McpConnectionNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;

  constructor() {
    super("MCP connection not found");
    this.name = "McpConnectionNotFoundError";
  }
}

export class McpOperationNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;

  constructor() {
    super("MCP operation not found");
    this.name = "McpOperationNotFoundError";
  }
}

/** Bloqueia mutations MCP sensíveis quando o literal de confirmação não bate. */
export class McpConfirmationRequiredError extends Error {
  readonly code = "CONFIRMATION_REQUIRED";
  readonly status = 409;

  constructor(expected: string) {
    super(`Explicit confirmation required: ${expected}`);
    this.name = "McpConfirmationRequiredError";
  }
}
