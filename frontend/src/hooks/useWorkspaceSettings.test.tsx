// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceConfig } from "../lib/types";
import { useWorkspaceSettings } from "./useWorkspaceSettings";

const config: WorkspaceConfig = { agent_backend: "chatgpt", default_model: "chosen", reasoning_effort: null, ui_language: "en", canonical_graph_language: "en", disable_idle_animations: false, memory_mode: "balanced", assistant_nickname: "", persona_rules: "", quiz_question_count: 12, pass_threshold: 0.75, enable_closure_tests: true, debug_mode_enabled: false, memory_history_message_limit: 32, memory_include_graph_context: true, memory_include_progress_context: true, memory_include_quiz_context: true, memory_include_frontier_context: true, memory_include_selected_topic_context: true, allow_explore_without_closure: true, require_prerequisite_closure_for_completion: true };
let root: Root;
let settings: ReturnType<typeof useWorkspaceSettings>;
const update = vi.fn().mockResolvedValue(undefined);
function Harness({ value }: { value: WorkspaceConfig }) {
  settings = useWorkspaceSettings({ config: value, updateWorkspaceConfig: update, straightEdgeLinesEnabled: false, setStraightEdgeLinesEnabled: vi.fn(), initialThemeMode: "dark" });
  return null;
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); update.mockClear(); root = createRoot(document.createElement("div")); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("keeps unsaved drafts across unrelated snapshots while updating clean fields", async () => {
  await act(async () => root.render(<Harness value={config} />));
  await act(async () => { settings.setDrafts.persona("My unsaved style"); settings.setDrafts.model("unavailable-explicit-choice"); });
  await act(async () => root.render(<Harness value={{ ...config, assistant_nickname: "New nickname" }} />));
  expect(settings.drafts.persona).toBe("My unsaved style");
  expect(settings.drafts.model).toBe("unavailable-explicit-choice");
  expect(settings.drafts.assistantNickname).toBe("New nickname");
  expect(settings.settingsDirty).toBe(true);
});
it("recognizes the saved draft when the authoritative config arrives", async () => {
  await act(async () => root.render(<Harness value={config} />));
  await act(async () => { settings.setDrafts.persona("New style"); });
  await act(async () => root.render(<Harness value={{ ...config, persona_rules: "New style" }} />));
  expect(settings.drafts.persona).toBe("New style");
  expect(settings.settingsDirty).toBe(false);
});
