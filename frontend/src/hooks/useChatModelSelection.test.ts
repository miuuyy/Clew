import { describe, expect, it } from "vitest";
import { resolveChatGPTModel } from "./useChatModelSelection";
import type { ChatGPTModel } from "../lib/types";
const models: ChatGPTModel[] = [{ id: "a", model: "native-default", isDefault: true, displayName: "A", description: "" }];
describe("ChatGPT model selection", () => {
  it("uses the plan catalog default", () => expect(resolveChatGPTModel(null, null, models)).toBe("native-default"));
  it("does not silently replace an unavailable explicit model", () => expect(resolveChatGPTModel("unavailable", null, models)).toBe("unavailable"));
  it("keeps the workspace selection when no per-graph choice exists", () => expect(resolveChatGPTModel(null, "workspace-choice", models)).toBe("workspace-choice"));
  it("does not invent a model before catalog discovery", () => expect(resolveChatGPTModel(null, null, [])).toBeNull());
});
