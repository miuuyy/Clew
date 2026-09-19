import { API_BASE } from "./api";

type DebugKind = "frontend" | "api";
type DebugLevel = "info" | "error";

type DebugPayload = {
  kind: DebugKind;
  level: DebugLevel;
  title: string;
  message: string;
  method?: string | null;
  path?: string | null;
  status_code?: number | null;
  duration_ms?: number | null;
  request_excerpt?: string | null;
  response_excerpt?: string | null;
  stack?: string | null;
};

let debugEnabled = false;
let hooksInstalled = false;
let unbindHooks: (() => void) | null = null;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization)/i;
const PRIVATE_TEXT_KEYS = new Set([
  "assistant_message",
  "content",
  "messages",
  "persona_rules",
  "prompt",
  "raw_text",
  "reply_message",
]);
const PRIVATE_PATH_PATTERNS = [
  /\/api\/v1\/codex(?:\/.*)?$/,
  /\/api\/v1\/workspace\/config$/,
  /\/api\/v1\/graphs\/[^/]+\/assistant$/,
  /\/api\/v1\/graphs\/[^/]+\/apply$/,
  /\/api\/v1\/graphs\/[^/]+\/chat(?:\/.*)?$/,
  /\/api\/v1\/graphs\/[^/]+\/normalize$/,
];

function clipText(value: unknown, limit = 4000): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

function shouldSkip(url: string): boolean {
  return url.includes("/api/v1/debug/logs");
}

function summarizePrivateText(value: string): string {
  const text = value.trim();
  if (!text) return "";
  return `[redacted text ${text.length} chars]`;
}

function redactSecretPatterns(value: string): string {
  return value
    .replace(
      /("?(?:gemini_api_key|openai_api_key|api[_-]?key|authorization|token|secret|password)"?\s*[:=]\s*)(".*?"|'.*?'|[^,\s}]+)/gi,
      "$1[redacted]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

function sanitizeDebugValue(value: unknown, fieldName?: string): unknown {
  if (fieldName && SENSITIVE_KEY_PATTERN.test(fieldName)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    if (fieldName === "messages") {
      return `[${value.length} messages redacted]`;
    }
    return value.slice(0, 5).map((item) => sanitizeDebugValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeDebugValue(item, key)]),
    );
  }
  if (typeof value === "string") {
    if (fieldName && PRIVATE_TEXT_KEYS.has(fieldName)) {
      return summarizePrivateText(value);
    }
    return redactSecretPatterns(value);
  }
  return value;
}

function sanitizeDebugExcerpt(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return clipText(JSON.stringify(sanitizeDebugValue(parsed)));
  } catch {
    return clipText(redactSecretPatterns(text));
  }
}

function shouldOmitBodies(url: string): boolean {
  return PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(url));
}

async function postDebugLog(payload: DebugPayload): Promise<void> {
  if (!debugEnabled) return;
  if (shouldSkip(payload.path ?? "")) return;
  try {
    await fetch(`${API_BASE}/api/v1/debug/logs/client`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Fail closed: local debug logging must never break product flows.
  }
}

function installHooks(): void {
  if (hooksInstalled || typeof window === "undefined") return;
  const onError = (event: ErrorEvent) => {
    void postDebugLog({
      kind: "frontend",
      level: "error",
      title: event.message || "Unhandled frontend error",
      message: clipText(event.error?.message ?? event.message ?? "Unknown frontend error") ?? "Unknown frontend error",
      path: window.location.pathname,
      stack: clipText(event.error?.stack ?? `${event.filename}:${event.lineno}:${event.colno}`, 8000),
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    void postDebugLog({
      kind: "frontend",
      level: "error",
      title: "Unhandled promise rejection",
      message: clipText(reason?.message ?? reason ?? "Unhandled promise rejection") ?? "Unhandled promise rejection",
      path: window.location.pathname,
      stack: clipText(reason?.stack, 8000),
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  unbindHooks = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
  hooksInstalled = true;
}

function uninstallHooks(): void {
  if (!hooksInstalled) return;
  unbindHooks?.();
  unbindHooks = null;
  hooksInstalled = false;
}

export function setDebugModeEnabled(enabled: boolean): void {
  debugEnabled = enabled;
  if (enabled) installHooks();
  else uninstallHooks();
}

export async function recordApiDebugLog(params: {
  url: string;
  method: string;
  statusCode?: number | null;
  durationMs: number;
  ok: boolean;
  requestBody?: string | null;
  responseBody?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  if (!debugEnabled || shouldSkip(params.url)) return;
  const url = (() => {
    try {
      return new URL(params.url, window.location.origin).pathname;
    } catch {
      return params.url;
    }
  })();
  const omitBodies = shouldOmitBodies(url);
  await postDebugLog({
    kind: "api",
    level: params.ok ? "info" : "error",
    title: `${params.method.toUpperCase()} ${url}`,
    message: params.errorMessage ?? (params.ok ? "Request completed" : "Request failed"),
    method: params.method.toUpperCase(),
    path: url,
    status_code: params.statusCode ?? null,
    duration_ms: Math.round(params.durationMs),
    request_excerpt: omitBodies ? "[omitted for privacy]" : sanitizeDebugExcerpt(params.requestBody),
    response_excerpt: omitBodies ? "[omitted for privacy]" : sanitizeDebugExcerpt(params.responseBody),
  });
}
