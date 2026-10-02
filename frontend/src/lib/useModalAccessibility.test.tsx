// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useModalAccessibility } from "./useModalAccessibility";

it("keeps input focus across rerenders, uses the current close callback, and restores focus on unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callbacks.push(callback); return callbacks.length; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const firstClose = vi.fn();
  const secondClose = vi.fn();
  function Dialog({ onClose }: { onClose: () => void }) {
    const modalRef = useRef<HTMLDivElement>(null);
    const focusRef = useRef<HTMLInputElement>(null);
    useModalAccessibility({ isOpen: true, modalRef, initialFocusRef: focusRef, onClose });
    return <div ref={modalRef} tabIndex={-1}><input ref={focusRef} /><button>Close</button></div>;
  }
  try {
    await act(async () => root.render(<Dialog onClose={firstClose} />));
    callbacks[0](0);
    const input = container.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    await act(async () => root.render(<Dialog onClose={secondClose} />));
    expect(callbacks).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
    opener.remove(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
