import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/api";
import { apiFetch } from "../lib/apiRequest";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const mutating = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (mutating.current) return;
    if (inFlight.current) return inFlight.current;
    const started = generation.current;
    setLoading(true);
    const pending = (async () => {
      try {
        const result = await chatgptRequest<ChatGPTAccount>("account");
        if (started !== generation.current) return;
        setAccount(result);
        setError(null);
      } catch (cause) {
        if (started === generation.current) {
          setAccount(null);
          setError(cause instanceof Error ? cause.message : "Could not reach Clew.");
        }
      } finally {
        if (started === generation.current) setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = pending;
    return pending;
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!account?.login) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [account?.login?.loginId, refresh]);

  async function mutate(operation: () => Promise<void>, failure: string) {
    if (mutating.current) return;
    mutating.current = true;
    generation.current += 1;
    setError(null);
    setLoading(true);
    try {
      await operation();
      setAccount(await chatgptRequest<ChatGPTAccount>("account"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      mutating.current = false;
      setLoading(false);
    }
  }

  const login = async () => {
    if (mutating.current) return;
    setWarning(null);
    // The browser popup must open inside the click, before the OAuth request.
    const popup = window.clewDesktop ? null : window.open("about:blank", "clew-chatgpt-login");
    if (!window.clewDesktop && !popup) {
      setError("Allow popups for Clew, then try signing in again.");
      return;
    }
    if (popup) popup.opener = null;
    await mutate(async () => {
      try {
        const result = await chatgptRequest<ChatGPTLogin>("login", {});
        setAccount((current) => ({ authenticated: false, sharing: false, can_disconnect: false, connected: true, models: [], account: null,
          ...current, login: result, error: null }));
        if (window.clewDesktop) await window.clewDesktop.openExternal(result.authUrl);
        else popup!.location.replace(result.authUrl);
      } catch (cause) { popup?.close(); throw cause; }
    }, "Sign in failed.");
  };
  const logout = () => mutate(async () => {
    const result = await chatgptRequest<{ warning: string | null }>("logout", {});
    setAccount(null);
    setWarning(result.warning);
  }, "Sign out failed.");
  const cancelLogin = () => mutate(async () => {
    await chatgptRequest("login/cancel", {});
    setAccount((current) => current ? { ...current, login: null } : null);
  }, "Could not cancel sign-in.");
  return { account, loading, error, warning, refresh, login, logout, cancelLogin };
}
export type ChatGPTAccountController = ReturnType<typeof useChatGPTAccount>;
