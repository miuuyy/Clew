import { isDebugModeEnabled, recordApiDebugLog } from "./debugLogs";

type ApiErrorPayload = {
  detail?: string | { errors?: string[]; warnings?: string[] };
};

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  const detail = payload?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const errors = Array.isArray(detail.errors) ? detail.errors.filter(Boolean) : [];
    const warnings = Array.isArray(detail.warnings) ? detail.warnings.filter(Boolean) : [];
    const parts = [...errors, ...warnings];
    if (parts.length > 0) return parts.join("; ");
  }
  return fallback;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const request = new Request(input, {
    ...(init ?? {}),
    credentials: "include",
  });
  if (typeof window !== "undefined" && window.clewDesktop) {
    const destination = new URL(request.url);
    const backend = new URL(window.clewDesktop.apiBase);
    if (destination.protocol !== backend.protocol || destination.host !== backend.host || !destination.pathname.startsWith("/api/v1/")) {
      throw new Error("Desktop API requests must target Clew's local API.");
    }
    request.headers.set("X-Clew-Session", window.clewDesktop.sessionToken);
  }
  const requestBody = typeof init?.body === "string" ? init.body : null;
  try {
    const response = await fetch(request);
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("clew-sign-in-required"));
    }
    const durationMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
    const contentType = response.headers.get("content-type") ?? "";
    const isStream =
      contentType.includes("text/event-stream")
      || contentType.includes("application/x-ndjson")
      || contentType.includes("application/ndjson");
    const responseBody = !isDebugModeEnabled() ? null : isStream ? "[stream response]" : await response.clone().text().catch(() => null);
    await recordApiDebugLog({
      url: request.url,
      method: request.method,
      statusCode: response.status,
      durationMs,
      ok: response.ok,
      requestBody,
      responseBody,
    });
    return response;
  } catch (error) {
    const durationMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
    await recordApiDebugLog({
      url: request.url,
      method: request.method,
      statusCode: null,
      durationMs,
      ok: false,
      requestBody,
      errorMessage: error instanceof Error ? error.message : "Network request failed",
    });
    throw error;
  }
}
