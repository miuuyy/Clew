// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatModelSelection } from "./useChatModelSelection";
const models = [{ id: "a", model: "a", displayName: "A", description: "", isDefault: true }];
let root: Root;
let selection: ReturnType<typeof useChatModelSelection>;
function Harness({ graph }: { graph: string }) { selection = useChatModelSelection(null, graph, models); return null; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); root = createRoot(document.createElement("div")); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("uses the latest selection for batched functional updates and persists it", async () => {
  await act(async () => root.render(<Harness graph="g" />));
  await act(async () => { selection.setSelectedChatModel((current) => `${current}-1`); selection.setSelectedChatModel((current) => `${current}-2`); });
  expect(selection.selectedChatModel).toBe("a-1-2");
  expect(localStorage.getItem("clew_chatgpt_model_v1:g")).toBe("a-1-2");
});
it("does not interpret inherited object keys as explicit model choices", async () => {
  await act(async () => root.render(<Harness graph="constructor" />));
  expect(selection.selectedChatModel).toBe("a");
  await act(async () => { selection.setSelectedChatModel("unavailable"); });
  expect(selection.selectedChatModel).toBe("unavailable");
});
it("keeps selections scoped to graphs and clearing one restores its plan default", async () => {
  await act(async () => root.render(<Harness graph="first" />));
  await act(async () => { selection.setSelectedChatModel("unavailable"); });
  await act(async () => root.render(<Harness graph="second" />));
  expect(selection.selectedChatModel).toBe("a");
  await act(async () => root.render(<Harness graph="first" />));
  expect(selection.selectedChatModel).toBe("unavailable");
  await act(async () => { selection.setSelectedChatModel(null); });
  expect(selection.selectedChatModel).toBe("a");
  expect(localStorage.getItem("clew_chatgpt_model_v1:first")).toBeNull();
});
