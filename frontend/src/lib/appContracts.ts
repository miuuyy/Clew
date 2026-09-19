import type { Dispatch, SetStateAction } from "react";

import type { AgentStatus, ChatMessage, ReasoningEffort, WorkspaceConfig } from "./types";

export const ASSISTANT_WIDTH_STORAGE_KEY = "knowledge_graph_assistant_width_v1";
export const ASSISTANT_MAX_WIDTH = 620;
export const ASSISTANT_MIN_WIDTH = 280;
export const ASSISTANT_COLLAPSE_THRESHOLD = 210;
export const APP_NAME = "Clew";
export const APP_TAGLINE = "AI-native workspace for structured learning";
export const APP_FAVICON_LIGHT_SRC = "/clew-favicon-light-accent.png";
export const APP_FAVICON_DARK_SRC = "/clew-favicon-dark.png";

export type MemoryMode = "balanced" | "max" | "custom";

export const MEMORY_MODE_OPTIONS: Array<{
  id: MemoryMode;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "balanced",
    label: "Balanced",
    title: "Recommended",
    description: "Graph, progress, quizzes, frontier, and selected topic. Imports 32 messages when connecting an existing chat.",
  },
  {
    id: "max",
    label: "Max",
    title: "Wider recall",
    description: "All graph context. Imports 64 messages when connecting an existing chat.",
  },
  {
    id: "custom",
    label: "Custom",
    title: "Manual context mix",
    description: "Choose fresh graph context and how much existing chat history to import. Codex retains ongoing conversations.",
  },
];

export type GraphChatState = {
  input: string;
  messages: ChatMessage[];
  sessionId?: string;
  runId?: string | null;
  status?: AgentStatus;
  error?: string | null;
  lastEventId?: number;
};

export type WorkspaceSurfacePayload = {
  onboarding_state: "needs_first_graph" | "active_workspace";
  active_graph_id?: string | null;
  graph_count: number;
  personal_graph_count: number;
  demo_graph_count: number;
  graph_limit: number;
  library_post_count: number;
  demo_library_post_id?: string | null;
  primary_action: "create_graph" | "resume_workspace";
  recommended_actions: Array<"create_graph" | "resume_workspace">;
  can_create_graph: boolean;
  can_import_from_library: boolean;
  grounding_default_enabled: boolean;
};

export type AuthSessionPayload = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url?: string | null;
    ui_language: "en";
    created_at: string;
    last_login_at?: string | null;
    active_workspace_id?: string | null;
  } | null;
  workspace_surface?: WorkspaceSurfacePayload | null;
};

export type ThemeMode = "dark" | "light";

export type WorkspaceConfigPatch = Partial<Omit<WorkspaceConfig, "agent_backend">>;

export type SettingsDrafts = {
  model: string;
  reasoningEffort: ReasoningEffort | "";
  assistantNickname: string;
  persona: string;
  disableIdleAnimations: boolean;
  memoryMode: MemoryMode;
  memoryHistoryLimit: number;
  memoryIncludeGraphContext: boolean;
  memoryIncludeProgressContext: boolean;
  memoryIncludeQuizContext: boolean;
  memoryIncludeFrontierContext: boolean;
  memoryIncludeSelectedTopicContext: boolean;
  enableClosureTests: boolean;
  debugModeEnabled: boolean;
  straightEdgeLines: boolean;
  themeMode: ThemeMode;
  quizQuestionCount: number;
  quizPassCount: number;
};

export type SettingsDraftSetters = { [K in keyof SettingsDrafts]: Dispatch<SetStateAction<SettingsDrafts[K]>> };
