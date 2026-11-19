import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/api";
import { apiFetch } from "../lib/apiRequest";
import { getAppCopy, type AppLocale } from "../lib/appLocale";
import type { ChatGPTAccount, ChatGPTLogin } from "../lib/types";

async function chatgptRequest<T>(locale: AppLocale, path: string, body?: object): Promise<T> {
  const labels = getAppCopy(locale).signIn;
  const headers = new Headers({ "Accept-Language": locale });
  if (body) headers.set("Content-Type", "application/json");
  const response = await apiFetch(`${API_BASE}/api/v1/chatgpt/${path}`, body
    ? { method: "POST", headers, body: JSON.stringify(body) } : { headers });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : labels.requestFailed(response.status));
  return result as T;
}

export function useChatGPTAccount(locale: AppLocale) {
  const labels = getAppCopy(locale).signIn;
  const [account, setAccount] = useState<ChatGPTAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const inFlight = useRef<{ locale: AppLocale; generation: number; promise: Promise<void> } | null>(null);
  const mutating = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (mutating.current) return;
    if (inFlight.current?.locale === locale) return inFlight.current.promise;
    const started = ++generation.current;
    setLoading(true);
    const pending = (async () => {
      try {
        const result = await chatgptRequest<ChatGPTAccount>(locale, "account");
        if (started !== generation.current) return;
        setAccount(result);
        setError(null);
      } catch (cause) {
        if (started === generation.current) {
          setAccount(null);
          setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : labels.unavailable);
        }
      } finally {
        if (started === generation.current) setLoading(false);
        if (inFlight.current?.generation === started) inFlight.current = null;
      }
    })();
    inFlight.current = { locale, generation: started, promise: pending };
    return pending;
  }, [locale, labels]);
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
      setAccount(await chatgptRequest<ChatGPTAccount>(locale, "account"));
    } catch (cause) {
      setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : failure);
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
      setError(labels.allowPopups);
      return;
    }
    if (popup) popup.opener = null;
    await mutate(async () => {
      try {
        const result = await chatgptRequest<ChatGPTLogin>(locale, "login", {});
        setAccount((current) => ({ authenticated: false, sharing: false, can_disconnect: false, connected: true, models: [], account: null,
          ...current, login: result, error: null }));
        if (window.clewDesktop) await window.clewDesktop.openExternal(result.authUrl);
        else popup!.location.replace(result.authUrl);
      } catch (cause) { popup?.close(); throw cause; }
    }, labels.loginFailed);
  };
  const logout = () => mutate(async () => {
    const result = await chatgptRequest<{ warning: string | null }>(locale, "logout", {});
    setAccount(null);
    setWarning(result.warning);
  }, labels.logoutFailed);
  const cancelLogin = () => mutate(async () => {
    await chatgptRequest(locale, "login/cancel", {});
    setAccount((current) => current ? { ...current, login: null } : null);
  }, labels.cancelFailed);
  return { account, loading, error, warning, refresh, login, logout, cancelLogin };
}
export type ChatGPTAccountController = ReturnType<typeof useChatGPTAccount>;
