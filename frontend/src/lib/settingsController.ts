import type { SettingsDrafts, WorkspaceConfigPatch } from "./appContracts";
import { requiredCorrectAnswers } from "./appUiHelpers";
import type { WorkspaceConfig } from "./types";

export function deriveSettingsDrafts(config: WorkspaceConfig): SettingsDrafts {
  return {
    model: config.default_model ?? "",
    reasoningEffort: config.reasoning_effort ?? "",
    assistantNickname: config.assistant_nickname ?? "",
    persona: config.persona_rules ?? "",
    disableIdleAnimations: config.disable_idle_animations ?? false,
    memoryMode: config.memory_mode ?? "balanced",
    memoryHistoryLimit: config.memory_history_message_limit ?? 32,
    memoryIncludeGraphContext: config.memory_include_graph_context ?? true,
    memoryIncludeProgressContext: config.memory_include_progress_context ?? true,
    memoryIncludeQuizContext: config.memory_include_quiz_context ?? true,
    memoryIncludeFrontierContext: config.memory_include_frontier_context ?? true,
    memoryIncludeSelectedTopicContext: config.memory_include_selected_topic_context ?? true,
    enableClosureTests: config.enable_closure_tests ?? true,
    debugModeEnabled: config.debug_mode_enabled ?? false,
    straightEdgeLines: false,
    themeMode: "dark",
    quizQuestionCount: config.quiz_question_count,
    quizPassCount: requiredCorrectAnswers(config.pass_threshold, config.quiz_question_count),
  };
}

export function isSettingsDirty(args: {
  config: WorkspaceConfig | null; drafts: SettingsDrafts; straightEdgeLinesEnabled: boolean;
}): boolean {
  return !!args.config && (Object.keys(buildWorkspaceConfigPatch({ config: args.config, drafts: args.drafts })).length > 0
    || args.drafts.straightEdgeLines !== args.straightEdgeLinesEnabled);
}

export function buildWorkspaceConfigPatch(args: {
  config: WorkspaceConfig;
  drafts: SettingsDrafts;
}): WorkspaceConfigPatch {
  const { config, drafts } = args;
  const patch: WorkspaceConfigPatch = {};
  const currentQuizPassCount = requiredCorrectAnswers(config.pass_threshold, config.quiz_question_count);

  if (drafts.model !== (config.default_model ?? "")) patch.default_model = drafts.model || null;
  if (drafts.reasoningEffort !== (config.reasoning_effort ?? "")) patch.reasoning_effort = drafts.reasoningEffort || null;
  if (drafts.memoryMode !== config.memory_mode) patch.memory_mode = drafts.memoryMode;

  if (drafts.assistantNickname !== (config.assistant_nickname ?? "")) patch.assistant_nickname = drafts.assistantNickname;
  if (drafts.memoryMode === "custom") {
    if (drafts.memoryHistoryLimit !== (config.memory_history_message_limit ?? 32)) patch.memory_history_message_limit = drafts.memoryHistoryLimit;
    if (drafts.memoryIncludeGraphContext !== (config.memory_include_graph_context ?? true)) patch.memory_include_graph_context = drafts.memoryIncludeGraphContext;
    if (drafts.memoryIncludeProgressContext !== (config.memory_include_progress_context ?? true)) patch.memory_include_progress_context = drafts.memoryIncludeProgressContext;
    if (drafts.memoryIncludeQuizContext !== (config.memory_include_quiz_context ?? true)) patch.memory_include_quiz_context = drafts.memoryIncludeQuizContext;
    if (drafts.memoryIncludeFrontierContext !== (config.memory_include_frontier_context ?? true)) patch.memory_include_frontier_context = drafts.memoryIncludeFrontierContext;
    if (drafts.memoryIncludeSelectedTopicContext !== (config.memory_include_selected_topic_context ?? true)) patch.memory_include_selected_topic_context = drafts.memoryIncludeSelectedTopicContext;
  }

  if (drafts.disableIdleAnimations !== (config.disable_idle_animations ?? false)) patch.disable_idle_animations = drafts.disableIdleAnimations;
  if (drafts.enableClosureTests !== (config.enable_closure_tests ?? true)) patch.enable_closure_tests = drafts.enableClosureTests;
  if (drafts.debugModeEnabled !== (config.debug_mode_enabled ?? false)) patch.debug_mode_enabled = drafts.debugModeEnabled;
  if (drafts.persona !== (config.persona_rules ?? "")) patch.persona_rules = drafts.persona;
  if (drafts.quizQuestionCount !== config.quiz_question_count) patch.quiz_question_count = drafts.quizQuestionCount;
  if (drafts.quizPassCount !== currentQuizPassCount || drafts.quizQuestionCount !== config.quiz_question_count) {
    patch.pass_threshold = drafts.quizPassCount / drafts.quizQuestionCount;
  }

  return patch;
}
