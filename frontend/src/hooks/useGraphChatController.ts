import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { API_BASE } from "../lib/api";
import { activeChatSessionStorageKey, readStoredActiveChatSession } from "../lib/appStatePersistence";
import { apiFetch, makeMessageId, readErrorMessage } from "../lib/appUiHelpers";
import { fetchChatSessions } from "../lib/chatRequests";
import { activeAgentStatus, consumeAgentEvents, reduceAgentEvent, stateFromThread, upsertChatMessage } from "../lib/agentEvents";
import type { GraphChatState } from "../lib/appContracts";
import type { ChatMessage, ChatSessionSummary, GraphChatThread, GraphEnvelope } from "../lib/types";

type Params = {
  activeGraph: GraphEnvelope | null; selectedTopicId: string | null; selectedChatModel: string | null;
  defaultModel: string | null; composerUseGrounding: boolean; loadChatError: string; loadChatSessionsError: string;
};
const empty = (): GraphChatState => ({ input: "", messages: [] });

export function useGraphChatController({ activeGraph, selectedTopicId, selectedChatModel, defaultModel,
  composerUseGrounding, loadChatError, loadChatSessionsError }: Params) {
  const graphId = activeGraph?.graph_id ?? "";
  const [selectedSessions, setSelectedSessions] = useState<Record<string, string | null>>({});
  const activeSessionId = Object.prototype.hasOwnProperty.call(selectedSessions, graphId) ? selectedSessions[graphId] : readStoredActiveChatSession(graphId);
  const setActiveSessionId: Dispatch<SetStateAction<string | null>> = useCallback((value) => {
    setSelectedSessions((current) => {
      const previous = Object.prototype.hasOwnProperty.call(current, graphId) ? current[graphId] : readStoredActiveChatSession(graphId);
      const next = typeof value === "function" ? value(previous) : value;
      try {
        if (next) localStorage.setItem(activeChatSessionStorageKey(graphId), next);
        else localStorage.removeItem(activeChatSessionStorageKey(graphId));
      } catch { /* Storage is optional; server conversations remain authoritative. */ }
      return { ...current, [graphId]: next };
    });
  }, [graphId]);
  const key = `${graphId}:${activeSessionId ?? "general"}`;
  const [states, setStates] = useState<Record<string, GraphChatState>>({});
  const statesRef = useRef(states);
  const update = useCallback((target: string, updater: (state: GraphChatState) => GraphChatState) => {
    const next = { ...statesRef.current, [target]: updater(statesRef.current[target] ?? empty()) };
    statesRef.current = next;
    setStates(next);
  }, []);
  const updateCurrentChatState = useCallback((updater: (state: GraphChatState) => GraphChatState) => update(key, updater), [key, update]);
  const currentChatState = states[key] ?? empty();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, ChatSessionSummary[]>>({});
  const [sessionErrors, setSessionErrors] = useState<Record<string, string | null>>({});
  const [revision, setRevision] = useState(0);
  const streams = useRef(new Map<string, AbortController>());
  const busy = useRef(new Set<string>());
  const loadSessions = useCallback(async () => {
    if (!graphId) return;
    try {
      const result = await fetchChatSessions(apiFetch, `${API_BASE}/api/v1/graphs/${graphId}/chat/sessions`, loadChatSessionsError);
      setSessions((current) => ({ ...current, [graphId]: result }));
      setSessionErrors((current) => ({ ...current, [graphId]: null }));
    } catch (cause) { setSessionErrors((current) => ({ ...current, [graphId]: cause instanceof Error ? cause.message : loadChatSessionsError })); }
  }, [graphId, loadChatSessionsError]);
  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const readStream = useCallback(async (response: Response, target: string) => {
    if (!response.ok) throw new Error(await readErrorMessage(response, loadChatError));
    await consumeAgentEvents(response, (event) => update(target, (current) => reduceAgentEvent(current, event)));
    if (activeAgentStatus(statesRef.current[target]?.status)) {
      throw new Error("The chat connection closed. Reconnect to continue following Codex.");
    }
  }, [loadChatError, update]);

  useEffect(() => {
    if (!graphId) return;
    const controller = new AbortController();
    streams.current.set(key, controller);
    setLoadingKey(key);
    void (async () => {
      try {
        const query = activeSessionId ? `?session_id=${encodeURIComponent(activeSessionId)}` : "";
        const response = await apiFetch(`${API_BASE}/api/v1/graphs/${graphId}/chat${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error(await readErrorMessage(response, loadChatError));
        const thread = await response.json() as GraphChatThread;
        if (controller.signal.aborted) return;
        update(key, (current) => stateFromThread(current, thread));
        setLoadingKey((current) => current === key ? null : current);
        if (activeAgentStatus(thread.agent_status)) {
          const events = await apiFetch(`${API_BASE}/api/v1/graphs/${graphId}/chat/events?session_id=${encodeURIComponent(thread.session_id)}&after=${thread.last_event_id}`, { signal: controller.signal });
          await readStream(events, key);
        }
      } catch (cause) {
        if (!controller.signal.aborted) update(key, (current) => ({ ...current, error: cause instanceof Error ? cause.message : loadChatError }));
      } finally {
        if (!controller.signal.aborted) setLoadingKey((current) => current === key ? null : current);
      }
    })();
    return () => { streams.current.get(key)?.abort(); streams.current.delete(key); controller.abort(); };
  }, [graphId, activeSessionId, key, loadChatError, readStream, revision, update]);

  const sendChat = useCallback(async (overridePrompt?: string, options?: { hiddenUserMessage?: boolean; baseMessages?: ChatMessage[] }) => {
    const state = statesRef.current[key] ?? empty();
    const prompt = (overridePrompt ?? state.input).trim();
    if (!graphId || !prompt || busy.current.has(key) || activeAgentStatus(state.status)) return;
    busy.current.add(key);
    const user: ChatMessage = { id: makeMessageId(), role: "user", content: prompt, hidden: options?.hiddenUserMessage ?? false, created_at: new Date().toISOString() };
    update(key, (current) => ({ ...current, input: "", runId: null, status: "starting", error: null, messages: [...current.messages, user] }));
    streams.current.get(key)?.abort();
    const controller = new AbortController();
    streams.current.set(key, controller);
    let rejected = false;
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graphs/${graphId}/chat/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ prompt, client_message_id: user.id, hidden_user_message: user.hidden,
          selected_topic_id: activeSessionId ? sessions[graphId]?.find((session) => session.session_id === activeSessionId)?.topic_id ?? selectedTopicId : selectedTopicId,
          session_id: state.sessionId ?? activeSessionId, model: selectedChatModel ?? defaultModel, use_grounding: composerUseGrounding }),
      });
      rejected = !response.ok;
      await readStream(response, key);
    } catch (cause) {
      if (!controller.signal.aborted) update(key, (current) => ({ ...current,
        status: rejected ? "failed" : current.status,
        error: cause instanceof Error ? cause.message : loadChatError,
        ...(rejected ? { input: prompt, messages: current.messages.filter((message) => message.id !== user.id) } : {}),
      }));
    } finally { busy.current.delete(key); void loadSessions(); }
  }, [graphId, key, activeSessionId, selectedTopicId, selectedChatModel, defaultModel, composerUseGrounding, sessions, loadChatError, loadSessions, readStream, update]);

  const answerInteraction = async (interactionId: string, answer?: string, choiceIndex?: number) => {
    const sessionId = statesRef.current[key]?.sessionId;
    if (!sessionId) throw new Error("Conversation is still loading.");
    const response = await apiFetch(`${API_BASE}/api/v1/graphs/${graphId}/chat/answer`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, interaction_id: interactionId, answer, choice_index: choiceIndex }) });
    if (!response.ok) throw new Error(await readErrorMessage(response, "Could not send your answer."));
    const result = await response.json() as { message: ChatMessage };
    update(key, (current) => ({ ...current, messages: upsertChatMessage(current.messages, result.message) }));
  };
  const stopChat = async () => {
    const sessionId = statesRef.current[key]?.sessionId;
    if (!sessionId) return;
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graphs/${graphId}/chat/interrupt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not stop Codex."));
      const thread = await response.json() as GraphChatThread;
      update(key, (current) => stateFromThread(current, thread));
    } catch (cause) { update(key, (current) => ({ ...current, error: cause instanceof Error ? cause.message : "Could not stop Codex." })); }
  };
  const clearChatStateForGraph = (target: string | null | undefined) => {
    if (!target) return;
    const next = Object.fromEntries(Object.entries(statesRef.current).filter(([entry]) => !entry.startsWith(`${target}:`)));
    statesRef.current = next;
    setStates(next);
  };
  return { activeSessionId, setActiveSessionId, chatSessions: sessions[graphId] ?? [], currentChatState,
    chatLoading: activeAgentStatus(currentChatState.status), chatThreadLoading: loadingKey === key,
    chatError: currentChatState.error ?? null, chatSessionsError: sessionErrors[graphId] ?? null,
    updateCurrentChatState, clearChatStateForGraph, loadSessions, sendChat, answerInteraction, stopChat,
    reconnectChat: () => setRevision((current) => current + 1) };
}
