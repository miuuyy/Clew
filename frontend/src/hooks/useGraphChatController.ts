import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { API_BASE } from "../lib/api";
import { activeChatSessionStorageKey, readStoredActiveChatSession } from "../lib/appStatePersistence";
import { apiFetch, readErrorMessage } from "../lib/apiRequest";
import { makeMessageId } from "../lib/appUiHelpers";
import { fetchChatSessions } from "../lib/chatRequests";
import { activeAgentStatus, consumeAgentEvents, parseChatMessage, parseChatThread, reduceAgentEvent, stateFromThread, upsertChatMessage } from "../lib/agentEvents";
import type { GraphChatState } from "../lib/appContracts";
import type { ChatMessage, ChatSessionSummary, GraphEnvelope } from "../lib/types";

type Params = {
  activeGraph: GraphEnvelope | null; selectedTopicId: string | null; selectedChatModel: string | null;
  defaultModel: string | null; loadChatError: string; loadChatSessionsError: string;
};
const empty = (): GraphChatState => ({ input: "", messages: [] });

export function useGraphChatController({ activeGraph, selectedTopicId, selectedChatModel, defaultModel,
  loadChatError, loadChatSessionsError }: Params) {
  const graphId = activeGraph?.graph_id ?? "";
  const [selectedSessions, setSelectedSessions] = useState<Record<string, string | null>>({});
  const activeSessionId = Object.prototype.hasOwnProperty.call(selectedSessions, graphId) ? selectedSessions[graphId] : readStoredActiveChatSession(graphId);
  const setActiveSessionId: Dispatch<SetStateAction<string | null>> = useCallback((value) => {
    if (!graphId) return;
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
  const graphSessions = Object.prototype.hasOwnProperty.call(sessions, graphId) ? sessions[graphId] : [];
  const [sessionErrors, setSessionErrors] = useState<Record<string, string | null>>({});
  const [revision, setRevision] = useState(0);
  const streams = useRef(new Map<string, AbortController>());
  const busy = useRef(new Map<string, AbortController>());
  const sessionRequests = useRef(new Map<string, AbortController>());
  const topicBindings = useRef(new Map<string, string | null>());
  const graphGenerations = useRef(new Map<string, number>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const requests of [streams.current, busy.current, sessionRequests.current]) {
        for (const controller of requests.values()) controller.abort();
        requests.clear();
      }
    };
  }, []);
  const loadSessions = useCallback(async () => {
    if (!graphId || !mounted.current) return;
    sessionRequests.current.get(graphId)?.abort();
    const controller = new AbortController();
    sessionRequests.current.set(graphId, controller);
    try {
      const result = await fetchChatSessions(apiFetch, `${API_BASE}/api/v1/graphs/${graphId}/chat/sessions`, loadChatSessionsError, { signal: controller.signal });
      if (controller.signal.aborted || !mounted.current) return;
      if (result.some((session) => session.graph_id !== graphId)) throw new Error("The chat session list belongs to another graph.");
      setSessions((current) => ({ ...current, [graphId]: result }));
      setSessionErrors((current) => ({ ...current, [graphId]: null }));
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setSessionErrors((current) => ({ ...current, [graphId]: cause instanceof Error ? cause.message : loadChatSessionsError }));
    } finally {
      if (sessionRequests.current.get(graphId) === controller) sessionRequests.current.delete(graphId);
    }
  }, [graphId, loadChatSessionsError]);
  useEffect(() => { void loadSessions(); }, [loadSessions, revision]);

  const readStream = useCallback(async (response: Response, target: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!response.ok) throw new Error(await readErrorMessage(response, loadChatError));
    await consumeAgentEvents(response, (event) => {
      if (event.type !== "heartbeat" && activeSessionId && event.session_id !== activeSessionId) throw new Error("The chat event belongs to another conversation.");
      if (event.type === "thread_state" && event.thread.graph_id !== graphId) throw new Error("The chat response belongs to another graph.");
      update(target, (current) => {
        const next = reduceAgentEvent(current, event);
        if (event.type === "thread_state" && next !== current) topicBindings.current.set(target, event.thread.topic_id ?? null);
        return next;
      });
    }, signal);
    if (activeAgentStatus(statesRef.current[target]?.status)) {
      throw new Error("The chat connection closed. Reconnect to keep following the reply.");
    }
  }, [graphId, activeSessionId, loadChatError, update]);

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
        const thread = parseChatThread(await response.json());
        if (controller.signal.aborted) return;
        if (thread.graph_id !== graphId || (activeSessionId && thread.session_id !== activeSessionId)) throw new Error("The chat response belongs to another conversation.");
        topicBindings.current.set(key, thread.topic_id ?? null);
        update(key, (current) => stateFromThread(current, thread));
        setLoadingKey((current) => current === key ? null : current);
        if (activeAgentStatus(thread.agent_status)) {
          const events = await apiFetch(`${API_BASE}/api/v1/graphs/${graphId}/chat/events?session_id=${encodeURIComponent(thread.session_id)}&after=${thread.last_event_id}`, { signal: controller.signal });
          await readStream(events, key, controller.signal);
        }
      } catch (cause) {
        if (!controller.signal.aborted) update(key, (current) => ({ ...current, error: cause instanceof Error ? cause.message : loadChatError }));
      } finally {
        if (streams.current.get(key) === controller) {
          streams.current.delete(key);
          if (!controller.signal.aborted) setLoadingKey((current) => current === key ? null : current);
        }
      }
    })();
    return () => {
      streams.current.get(key)?.abort();
      streams.current.delete(key);
      if (busy.current.get(key)?.signal.aborted) busy.current.delete(key);
      controller.abort();
    };
  }, [graphId, activeSessionId, key, loadChatError, readStream, revision, update]);

  const sendChat = useCallback(async (overridePrompt?: string, options?: { hiddenUserMessage?: boolean; baseMessages?: ChatMessage[] }) => {
    const state = statesRef.current[key] ?? empty();
    const prompt = (overridePrompt ?? state.input).trim();
    if (!mounted.current || !graphId || !prompt || busy.current.has(key) || activeAgentStatus(state.status)) return;
    if (activeSessionId && !topicBindings.current.has(key)) {
      update(key, (current) => ({ ...current, error: current.error ?? "Conversation is still loading. Reconnect before sending a message." }));
      return;
    }
    const user: ChatMessage = { id: makeMessageId(), role: "user", content: prompt, hidden: options?.hiddenUserMessage ?? false, created_at: new Date().toISOString() };
    update(key, (current) => ({ ...current, input: user.hidden ? current.input : "", runId: null, status: "starting", error: null, messages: [...current.messages, user] }));
    streams.current.get(key)?.abort();
    const controller = new AbortController();
    streams.current.set(key, controller);
    busy.current.set(key, controller);
    setLoadingKey((current) => current === key ? null : current);
    let rejected = false;
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graphs/${graphId}/chat/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ prompt, client_message_id: user.id, hidden_user_message: user.hidden,
          selected_topic_id: activeSessionId ? topicBindings.current.get(key) ?? selectedTopicId : selectedTopicId,
          session_id: state.sessionId ?? activeSessionId, model: selectedChatModel ?? defaultModel }),
      });
      rejected = !response.ok;
      await readStream(response, key, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) update(key, (current) => ({ ...current,
        status: rejected ? "failed" : current.status,
        error: cause instanceof Error ? cause.message : loadChatError,
        ...(rejected ? { input: user.hidden ? current.input : current.input || prompt, messages: current.messages.filter((message) => message.id !== user.id) } : {}),
      }));
    } finally {
      if (busy.current.get(key) === controller) busy.current.delete(key);
      if (streams.current.get(key) === controller) streams.current.delete(key);
      if (!controller.signal.aborted && mounted.current) void loadSessions();
    }
  }, [graphId, key, activeSessionId, selectedTopicId, selectedChatModel, defaultModel, loadChatError, loadSessions, readStream, update]);

  const answerInteraction = async (interactionId: string, answer?: string, choiceIndex?: number) => {
    const before = statesRef.current[key];
    const sessionId = before?.sessionId;
    if (!sessionId) throw new Error("Conversation is still loading.");
    const generation = graphGenerations.current.get(graphId) ?? 0;
    const previous = before.messages.find((message) => message.question?.interaction_id === interactionId || message.inline_quiz?.interaction_id === interactionId);
    const response = await apiFetch(`${API_BASE}/api/v1/graphs/${graphId}/chat/answer`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, interaction_id: interactionId, answer, choice_index: choiceIndex }) });
    if (!response.ok) throw new Error(await readErrorMessage(response, "Could not send your answer."));
    const result: unknown = await response.json();
    const message = parseChatMessage(result && typeof result === "object" && "message" in result ? result.message : null);
    if (!mounted.current || generation !== (graphGenerations.current.get(graphId) ?? 0)) return;
    update(key, (current) => current.messages.find((item) => item.id === message.id) !== previous ? current :
      { ...current, messages: upsertChatMessage(current.messages, message) });
  };
  const stopChat = async () => {
    const sessionId = statesRef.current[key]?.sessionId;
    if (!sessionId) return;
    const runId = statesRef.current[key]?.runId;
    const generation = graphGenerations.current.get(graphId) ?? 0;
    const currentOperation = () => mounted.current && generation === (graphGenerations.current.get(graphId) ?? 0);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graphs/${graphId}/chat/interrupt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not stop the reply."));
      const thread = parseChatThread(await response.json());
      if (thread.graph_id !== graphId || thread.session_id !== sessionId) throw new Error("The stop response belongs to another conversation.");
      if (currentOperation()) update(key, (current) => current.runId !== runId ? current : stateFromThread(current, thread));
    } catch (cause) {
      if (currentOperation()) update(key, (current) => current.runId !== runId ? current :
        { ...current, error: cause instanceof Error ? cause.message : "Could not stop the reply." });
    }
  };
  const clearChatStateForGraph = (target: string | null | undefined) => {
    if (!target) return;
    graphGenerations.current.set(target, (graphGenerations.current.get(target) ?? 0) + 1);
    for (const requests of [streams.current, busy.current]) {
      for (const [entry, controller] of requests) if (entry.startsWith(`${target}:`)) {
        controller.abort();
        requests.delete(entry);
      }
    }
    sessionRequests.current.get(target)?.abort();
    sessionRequests.current.delete(target);
    for (const entry of topicBindings.current.keys()) if (entry.startsWith(`${target}:`)) topicBindings.current.delete(entry);
    setSelectedSessions((current) => ({ ...current, [target]: null }));
    try { localStorage.removeItem(activeChatSessionStorageKey(target)); } catch { /* Optional UI selection. */ }
    setSessions((current) => Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== target)));
    setSessionErrors((current) => Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== target)));
    setLoadingKey((current) => current?.startsWith(`${target}:`) ? null : current);
    const next = Object.fromEntries(Object.entries(statesRef.current).filter(([entry]) => !entry.startsWith(`${target}:`)));
    statesRef.current = next;
    setStates(next);
    if (target === graphId) setRevision((current) => current + 1);
  };
  return { activeSessionId, setActiveSessionId, chatSessions: graphSessions, currentChatState,
    chatLoading: activeAgentStatus(currentChatState.status), chatThreadLoading: loadingKey === key,
    chatError: currentChatState.error ?? null, chatSessionsError: Object.prototype.hasOwnProperty.call(sessionErrors, graphId) ? sessionErrors[graphId] : null,
    updateCurrentChatState, clearChatStateForGraph, loadSessions, sendChat, answerInteraction, stopChat,
    reconnectChat: () => setRevision((current) => current + 1) };
}
