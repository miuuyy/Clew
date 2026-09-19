import { describe, expect, it } from "vitest";

import { buildWorkspaceConfigPatch, deriveSettingsDrafts, isSettingsDirty } from "./settingsController";
import type { WorkspaceConfig } from "./types";

function makeConfig(): WorkspaceConfig {
  return {
    agent_backend: "codex",
    default_model: "codex-test",
    reasoning_effort: null,
    ui_language: "en",
    canonical_graph_language: "en",
    web_search_enabled: true,
    memory_mode: "balanced",
    assistant_nickname: "",
    disable_idle_animations: false,
    persona_rules: "",
    quiz_question_count: 12,
    pass_threshold: 0.75,
    enable_closure_tests: true,
    debug_mode_enabled: false,
    memory_history_message_limit: 32,
    memory_include_graph_context: true,
    memory_include_progress_context: true,
    memory_include_quiz_context: true,
    memory_include_frontier_context: true,
    memory_include_selected_topic_context: true,
    allow_explore_without_closure: true,
    require_prerequisite_closure_for_completion: true,
  };
}

describe("settingsController", () => {
  it("derives stable Codex settings and assessment threshold", () => {
    const drafts = deriveSettingsDrafts(makeConfig());
    expect(drafts.model).toBe("codex-test");
    expect(drafts.reasoningEffort).toBe("");
    expect(drafts.quizPassCount).toBe(9);
    expect(isSettingsDirty({ config: makeConfig(), drafts, straightEdgeLinesEnabled: false })).toBe(false);
  });
  it("supports explicit native defaults without sending an empty model id", () => {
    const config = makeConfig();
    const drafts = { ...deriveSettingsDrafts(config), model: "" };
    expect(buildWorkspaceConfigPatch({ config, drafts })).toEqual({ default_model: null });
  });
  it("builds a minimal model, reasoning, and quiz patch", () => {
    const config = makeConfig();
    const drafts = { ...deriveSettingsDrafts(config), reasoningEffort: "high" as const, debugModeEnabled: true, quizQuestionCount: 10, quizPassCount: 8 };
    expect(buildWorkspaceConfigPatch({ config, drafts })).toEqual({ reasoning_effort: "high", debug_mode_enabled: true, quiz_question_count: 10, pass_threshold: 0.8 });
  });
  it("ignores custom context fields while a preset is selected", () => {
    const config = makeConfig();
    const drafts = { ...deriveSettingsDrafts(config), memoryHistoryLimit: 100 };
    expect(buildWorkspaceConfigPatch({ config, drafts })).toEqual({});
    drafts.memoryMode = "custom";
    expect(buildWorkspaceConfigPatch({ config, drafts })).toEqual({ memory_mode: "custom", memory_history_message_limit: 100 });
  });
});
