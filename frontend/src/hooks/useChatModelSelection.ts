import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { ChatGPTModel, WorkspaceConfig } from "../lib/types";

export function resolveChatGPTModel(explicit: string | null, defaultModel: string | null | undefined, models: ChatGPTModel[]): string | null {
  return explicit ?? defaultModel ?? models.find((item) => item.isDefault)?.model ?? null;
}
const storageKey = (graphId: string) => `clew_chatgpt_model_v1:${graphId}`;
function storedModel(graphId: string): string | null {
  try { return localStorage.getItem(storageKey(graphId)); } catch { return null; }
}
export function useChatModelSelection(config: WorkspaceConfig | null, graphId: string | null, models: ChatGPTModel[]): {
  chatModelOptions: string[]; selectedChatModel: string | null; setSelectedChatModel: Dispatch<SetStateAction<string | null>>;
} {
  const [selections, setSelections] = useState<Record<string, string | null>>({});
  const key = graphId ?? "";
  const explicit = Object.prototype.hasOwnProperty.call(selections, key) ? selections[key] : storedModel(key);
  const selectedChatModel = resolveChatGPTModel(explicit, config?.default_model, models);
  const chatModelOptions = useMemo(() => Array.from(new Set([...(selectedChatModel ? [selectedChatModel] : []), ...models.map((item) => item.model)])), [models, selectedChatModel]);
  const setSelectedChatModel: Dispatch<SetStateAction<string | null>> = useCallback((value) => {
    if (!key) return;
    setSelections((current) => {
      const previous = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : storedModel(key);
      const next = typeof value === "function" ? value(resolveChatGPTModel(previous, config?.default_model, models)) : value;
      try { if (next) localStorage.setItem(storageKey(key), next); else localStorage.removeItem(storageKey(key)); } catch { /* Optional UI preference. */ }
      return { ...current, [key]: next };
    });
  }, [key, config?.default_model, models]);
  // Model choices persist per graph in the ChatGPT namespace.
  // An unavailable explicit choice remains visible and is rejected by the server.
  return { chatModelOptions, selectedChatModel, setSelectedChatModel };
}
