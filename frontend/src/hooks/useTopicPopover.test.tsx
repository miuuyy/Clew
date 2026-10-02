// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GraphEnvelope } from "../lib/types";
import { useTopicPopover } from "./useTopicPopover";
let root: Root;
let popover: ReturnType<typeof useTopicPopover>;
const graph = (id: string) => ({ graph_id: id, topics: [{ id: "shared", title: `Topic in ${id}` }] }) as GraphEnvelope;
function Harness({ id }: { id: string }) {
  const shell = useRef<HTMLDivElement>(null);
  popover = useTopicPopover({ activeGraph: graph(id), isMobileViewport: false, graphShellRef: shell });
  return <div ref={shell}><div ref={popover.topicPopoverRef} /></div>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1200, height: 900, left: 0, top: 0, x: 0, y: 0, right: 1200, bottom: 900, toJSON() {} });
  document.body.style.userSelect = "text";
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.style.userSelect = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function selectAndDrag() {
  await act(async () => root.render(<Harness id="first" />));
  await act(async () => popover.handleSelectTopic("shared", { x: 200, y: 200, side: "right" }));
  popover.popoverDragRef.current = { pointerX: 0, pointerY: 0, startX: 16, startY: 16 };
  await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 20 })));
  expect(document.body.style.userSelect).toBe("none");
}
it("clears graph-scoped selection even when the next graph has the same topic id", async () => {
  await act(async () => root.render(<Harness id="first" />));
  await act(async () => popover.handleSelectTopic("shared", { x: 200, y: 200, side: "right" }));
  await act(async () => root.render(<Harness id="second" />));
  expect(popover.selectedTopicId).toBeNull();
  expect(popover.selectedTopicAnchor).toBeNull();
  expect(popover.popoverPosition).toBeNull();
});
it("restores the prior selection style on pointer cancellation and unmount", async () => {
  await selectAndDrag();
  await act(async () => window.dispatchEvent(new Event("pointercancel")));
  expect(popover.popoverDragRef.current).toBeNull();
  expect(document.body.style.userSelect).toBe("text");
  popover.popoverDragRef.current = { pointerX: 0, pointerY: 0, startX: 16, startY: 16 };
  await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 20 })));
  await act(async () => root.unmount());
  expect(document.body.style.userSelect).toBe("text");
  root = createRoot(document.createElement("div"));
});
it("does not clear another component's selection lock on an unrelated pointerup", async () => {
  await act(async () => root.render(<Harness id="first" />));
  document.body.style.userSelect = "none";
  window.dispatchEvent(new Event("pointerup"));
  expect(document.body.style.userSelect).toBe("none");
});
