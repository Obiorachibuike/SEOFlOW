/**
 * Structured JSON logging for SEOFlow.
 *
 * - Emits one JSON object per line (Vercel Runtime Logs parses these).
 * - Redacts credentials, tokens, cookies and connection strings before writing.
 * - Never throws: logging failures must not break authentication requests.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50
};

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|auth[-_]?header|cookie|set-cookie|api[-_]?key|access[-_]?key|client[-_]?secret|private[-_]?key|connection[-_]?string|database[-_]?url|pgpassword|pwd|credential|ciphertext|signature|session)/i;

const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/[^\s"'`]+/gi;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER_PATTERN = /bearer\s+[a-zA-Z0-9._~+/=-]+/gi;

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error" || raw === "fatal") {
    return raw;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export function redactString(value: string): string {
  return value
    .replace(CONNECTION_STRING_PATTERN, "postgres://[redacted]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(EMAIL_PATTERN, "[redacted-email]");
}

function redactKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
}

const MAX_DEPTH = 4;
const MAX_ARRAY = 20;
const MAX_STRING = 500;

function sanitizeValue(key: string, value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }
  if (value === null || value === undefined) {
    return value ?? null;
  }
  const valueType = typeof value;
  if (valueType === "string") {
    const text = redactString(value as string);
    return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
  }
  if (valueType === "number" || valueType === "boolean") {
    return value;
  }
  if (valueType === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return sanitizeError(value);
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return "[array]";
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeValue("item", item, depth + 1, seen));
  }
  if (valueType === "object") {
    if (seen.has(value as object)) return "[circular]";
    if (depth >= MAX_DEPTH) return "[object]";
    seen.add(value as object);
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      output[redactKey(childKey)] = sanitizeValue(childKey, childValue, depth + 1, seen);
    }
    return output;
  }
  return String(value);
}

export function sanitizeForLog(input: unknown): unknown {
  try {
    return sanitizeValue("root", input, 0, new WeakSet());
  } catch {
    return "[unserializable]";
  }
}

function sanitizeError(error: Error): Record<string, unknown> {
  const pgCode = (error as { code?: unknown }).code;
  return {
    name: error.name,
    message: typeof error.message === "string" ? redactString(error.message).slice(0, MAX_STRING) : "Unknown error",
    ...(typeof pgCode === "string" ? { code: pgCode } : {})
  };
}

function write(level: LogLevel, event: string, fields: LogFields | undefined): void {
  try {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) {
      return;
    }
    const entry: Record<string, unknown> = {
      severity: level.toUpperCase(),
      timestamp: new Date().toISOString(),
      service: "seoflow",
      event,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      ...(fields ? (sanitizeForLog(fields) as Record<string, unknown>) : {})
    };
    const line = JSON.stringify(entry);
    if (level === "error" || level === "fatal") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  } catch {
    // Logging must never crash the application.
  }
}

export type Logger = {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  fatal: (event: string, fields?: LogFields) => void;
  child: (bindings: LogFields) => Logger;
};

export function createLogger(bindings: LogFields = {}): Logger {
  const make = (bound: LogFields): Logger => ({
    debug: (event, fields) => write("debug", event, { ...bound, ...fields }),
    info: (event, fields) => write("info", event, { ...bound, ...fields }),
    warn: (event, fields) => write("warn", event, { ...bound, ...fields }),
    error: (event, fields) => write("error", event, { ...bound, ...fields }),
    fatal: (event, fields) => write("fatal", event, { ...bound, ...fields }),
    child: (childBindings) => make({ ...bound, ...sanitizeForLog(childBindings) as LogFields })
  });
  return make(sanitizeForLog(bindings) as LogFields);
}

export const logger: Logger = createLogger();

/** Extract safe, structured diagnostics from an unknown thrown value. */
export function errorDiagnostics(error: unknown): LogFields {
  if (error instanceof Error) {
    const pgCode = (error as { code?: unknown }).code;
    const pgSeverity = (error as { severity?: unknown }).severity;
    const pgRoutine = (error as { routine?: unknown }).routine;
    return {
      errorName: error.name,
      errorMessage: redactString(error.message).slice(0, MAX_STRING),
      ...(typeof pgCode === "string" ? { pgCode } : {}),
      ...(typeof pgSeverity === "string" ? { pgSeverity } : {}),
      ...(typeof pgRoutine === "string" ? { pgRoutine } : {})
    };
  }
  return { errorName: "UnknownError", errorMessage: redactString(String(error)).slice(0, MAX_STRING) };
}
