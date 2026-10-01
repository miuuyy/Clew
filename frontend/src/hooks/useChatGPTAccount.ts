import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/api";
import { apiFetch } from "../lib/appUiHelpers";
import type { ChatGPTAccount, ChatGPTLogin } from "../lib/types";

export async function chatgptRequest<T>(path: string, body?: object): Promise<T> {
  const response = await apiFetch(`${API_BASE}/api/v1/chatgpt/${path}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : `ChatGPT request failed (${response.status})`);
  return result as T;
}

export function useChatGPTAccount() {
  const [account, setAccount] = useState<ChatGPTAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setAccount(await chatgptRequest<ChatGPTAccount>("account"));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach Clew.");
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
  const login = async () => {
    setError(null);
    setWarning(null);
    setLoading(true);
    // Open synchronously from the click so popup blockers do not swallow OAuth.
    const popup = window.open("about:blank", "clew-chatgpt-login");
    if (popup) popup.opener = null;
    try {
      const result = await chatgptRequest<ChatGPTLogin>("login", {});
      if (popup) popup.location.replace(result.authUrl);
      setAccount((current) => current ? { ...current, login: result, error: null } : current);
      await refresh();
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : "Sign in failed.");
    } finally { setLoading(false); }
  };
  const logout = async () => {
    setLoading(true);
    try {
      const result = await chatgptRequest<{ warning: string | null }>("logout", {});
      setWarning(result.warning);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign out failed."); }
    finally { setLoading(false); }
  };
  const cancelLogin = async () => {
    setLoading(true);
    try { await chatgptRequest("login/cancel", {}); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ChatGPT request failed."); }
    finally { setLoading(false); }
  };
  return { account, loading, error, warning, refresh, login, logout, cancelLogin };
}
export type ChatGPTAccountController = ReturnType<typeof useChatGPTAccount>;
