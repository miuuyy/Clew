function isLocalHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function resolveApiBase(): string {
  if (typeof window !== "undefined" && window.clewDesktop) return window.clewDesktop.apiBase;
  const configured = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://127.0.0.1:8787";
  if (isLocalHost(window.location.hostname)) return "http://127.0.0.1:8787";
  return window.location.origin.replace(/\/$/, "");
}

export const API_BASE = resolveApiBase();
export const AUTH_API_BASE = API_BASE;
