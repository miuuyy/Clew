import { useEffect, useMemo, useState } from "react";

import {
  MEMORY_MODE_OPTIONS,
  type SettingsDraftSetters,
  type SettingsDrafts,
  type ThemeMode,
} from "../lib/appContracts";
import {
  buildWorkspaceConfigPatch,
  deriveSettingsDrafts,
  isSettingsDirty,
} from "../lib/settingsController";
import type { WorkspaceConfig } from "../lib/types";

type WorkspaceConfigUpdater = (patch: Record<string, unknown>) => Promise<void>;

type UseWorkspaceSettingsArgs = {
  config: WorkspaceConfig | null;
  updateWorkspaceConfig: WorkspaceConfigUpdater;
  straightEdgeLinesEnabled: boolean;
  setStraightEdgeLinesEnabled: (value: boolean) => void;
  initialThemeMode: ThemeMode;
};

type UseWorkspaceSettingsResult = {
  drafts: SettingsDrafts;
  setDrafts: SettingsDraftSetters;
  settingsDirty: boolean;
  activeMemoryOption: (typeof MEMORY_MODE_OPTIONS)[number];
  activeMemoryValues: string;
  liveDisableIdleAnimations: boolean;
  debugModeEnabled: boolean;
  saveSettings: () => void;
};

export function useWorkspaceSettings({
  config,
  updateWorkspaceConfig,
  straightEdgeLinesEnabled,
  setStraightEdgeLinesEnabled,
  initialThemeMode,
}: UseWorkspaceSettingsArgs): UseWorkspaceSettingsResult {
  const [drafts, setDraftsState] = useState<SettingsDrafts>({
    model: "",
    reasoningEffort: "",
    assistantNickname: "",
    persona: "",
    disableIdleAnimations: false,
    memoryMode: "balanced",
    memoryHistoryLimit: 32,
    memoryIncludeGraphContext: true,
    memoryIncludeProgressContext: true,
    memoryIncludeQuizContext: true,
    memoryIncludeFrontierContext: true,
    memoryIncludeSelectedTopicContext: true,
    enableClosureTests: true,
    debugModeEnabled: false,
    straightEdgeLines: straightEdgeLinesEnabled,
    themeMode: initialThemeMode,
    quizQuestionCount: 12,
    quizPassCount: 9,
  });

  useEffect(() => {
    if (!config) return;
    setDraftsState((current) => ({
      ...deriveSettingsDrafts(config),
      straightEdgeLines: current.straightEdgeLines,
      themeMode: current.themeMode ?? initialThemeMode,
    }));
  }, [config, initialThemeMode]);

  const settingsDirty = useMemo(
    () =>
      isSettingsDirty({
        config,
        drafts,
            straightEdgeLinesEnabled,
      }),
    [config, drafts, straightEdgeLinesEnabled],
  );

  const activeMemoryOption = MEMORY_MODE_OPTIONS.find((option) => option.id === drafts.memoryMode) ?? MEMORY_MODE_OPTIONS[1];

  const activeMemoryValues =
    drafts.memoryMode === "custom"
      ? `${drafts.memoryHistoryLimit} recent messages · graph ${drafts.memoryIncludeGraphContext ? "on" : "off"} · progress ${drafts.memoryIncludeProgressContext ? "on" : "off"} · quiz ${drafts.memoryIncludeQuizContext ? "on" : "off"} · frontier ${drafts.memoryIncludeFrontierContext ? "on" : "off"} · selected topic ${drafts.memoryIncludeSelectedTopicContext ? "on" : "off"}`
      : activeMemoryOption.description;

  function updateDraft<K extends keyof SettingsDrafts>(key: K, value: SettingsDrafts[K] | ((current: SettingsDrafts[K]) => SettingsDrafts[K])): void {
    setDraftsState((current) => ({
      ...current,
      [key]: typeof value === "function" ? (value as (item: SettingsDrafts[K]) => SettingsDrafts[K])(current[key]) : value,
    }));
  }

  const setDrafts: SettingsDraftSetters = {
    model: (value) => updateDraft("model", value),
    reasoningEffort: (value) => updateDraft("reasoningEffort", value),
    assistantNickname: (value) => updateDraft("assistantNickname", value),
    persona: (value) => updateDraft("persona", value),
    disableIdleAnimations: (value) => updateDraft("disableIdleAnimations", value),
    memoryMode: (value) => updateDraft("memoryMode", value),
    memoryHistoryLimit: (value) => updateDraft("memoryHistoryLimit", value),
    memoryIncludeGraphContext: (value) => updateDraft("memoryIncludeGraphContext", value),
    memoryIncludeProgressContext: (value) => updateDraft("memoryIncludeProgressContext", value),
    memoryIncludeQuizContext: (value) => updateDraft("memoryIncludeQuizContext", value),
    memoryIncludeFrontierContext: (value) => updateDraft("memoryIncludeFrontierContext", value),
    memoryIncludeSelectedTopicContext: (value) => updateDraft("memoryIncludeSelectedTopicContext", value),
    enableClosureTests: (value) => updateDraft("enableClosureTests", value),
    debugModeEnabled: (value) => updateDraft("debugModeEnabled", value),
    straightEdgeLines: (value) => updateDraft("straightEdgeLines", value),
    themeMode: (value) => updateDraft("themeMode", value),
    quizQuestionCount: (value) => updateDraft("quizQuestionCount", value),
    quizPassCount: (value) => updateDraft("quizPassCount", value),
  };

  useEffect(() => {
    setDrafts.quizPassCount((current) => Math.min(current, drafts.quizQuestionCount));
  }, [drafts.quizQuestionCount]);

  function saveSettings(): void {
    if (!config) return;
    const patch = buildWorkspaceConfigPatch({ config, drafts });
    if (drafts.straightEdgeLines !== straightEdgeLinesEnabled) {
      setStraightEdgeLinesEnabled(drafts.straightEdgeLines);
    }
    if (Object.keys(patch).length > 0) {
      void updateWorkspaceConfig(patch);
    }
  }

  return {
    drafts,
    setDrafts,
    settingsDirty,
    activeMemoryOption,
    activeMemoryValues,
    liveDisableIdleAnimations: drafts.disableIdleAnimations,
    debugModeEnabled: drafts.debugModeEnabled,
    saveSettings,
  };
}
