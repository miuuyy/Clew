import { describe, expect, it } from "vitest";
import { resolveCodexModel } from "./useChatModelSelection";
import type { CodexModel } from "../lib/types";
const models: CodexModel[] = [{ id: "a", model: "native-default", isDefault: true, displayName: "A", description: "", defaultReasoningEffort: "medium", supportedReasoningEfforts: [] }];
describe("Codex model selection", () => {
  it("uses the advertised server default", () => expect(resolveCodexModel(null, null, models)).toBe("native-default"));
  it("does not silently replace an unavailable explicit model", () => expect(resolveCodexModel("unavailable", null, models)).toBe("unavailable"));
  it("keeps the workspace selection when no per-graph choice exists", () => expect(resolveCodexModel(null, "workspace-choice", models)).toBe("workspace-choice"));
  it("does not invent a model before catalog discovery", () => expect(resolveCodexModel(null, null, [])).toBeNull());
});
