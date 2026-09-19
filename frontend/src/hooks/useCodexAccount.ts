import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/api";
import { apiFetch } from "../lib/appUiHelpers";
import type { CodexAccount, CodexLogin } from "../lib/types";

export async function codexRequest<T>(path: string, body?: object): Promise<T> {
  const response = await apiFetch(`${API_BASE}/api/v1/codex/${path}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : `Codex request failed (${response.status})`);
  return result as T;
}

export function useCodexAccount() {
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setAccount(await codexRequest<CodexAccount>("account"));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect to Codex.");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!account?.login) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [account?.login?.loginId, refresh]);
  const login = async (deviceCode = false) => {
    setError(null);
    setLoading(true);
    // Open synchronously from the click so popup blockers do not swallow OAuth.
    const popup = !deviceCode ? window.open("about:blank", "clew-codex-login") : null;
    if (popup) popup.opener = null;
    try {
      const result = await codexRequest<CodexLogin>("login", { device_code: deviceCode });
      if (result.authUrl && popup) popup.location.replace(result.authUrl);
      else popup?.close();
      setAccount((current) => current ? { ...current, login: result, error: null } : current);
      await refresh();
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : "Sign in failed.");
    } finally { setLoading(false); }
  };
  const action = async (path: "logout" | "login/cancel") => {
    setLoading(true);
    try { await codexRequest(path, {}); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Codex request failed."); }
    finally { setLoading(false); }
  };
  return { account, loading, error, refresh, login, logout: () => action("logout"), cancelLogin: () => action("login/cancel") };
}
export type CodexAccountController = ReturnType<typeof useCodexAccount>;
