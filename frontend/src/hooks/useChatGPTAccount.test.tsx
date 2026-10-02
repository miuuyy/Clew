// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../lib/apiRequest";
import type { ChatGPTAccount } from "../lib/types";
import { useChatGPTAccount, type ChatGPTAccountController } from "./useChatGPTAccount";

vi.mock("../lib/apiRequest", () => ({ apiFetch: vi.fn() }));
const request = vi.mocked(apiFetch);
const signedOut: ChatGPTAccount = { authenticated: false, sharing: false, can_disconnect: false, connected: true, models: [], account: null, login: null, error: null };
const signedIn: ChatGPTAccount = { ...signedOut, authenticated: true, sharing: true, account: { email: "learner@example.test" } };
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let root: Root;
let controller: ChatGPTAccountController;
function Harness() { controller = useChatGPTAccount(); return null; }
async function mount(account = signedIn) {
  request.mockResolvedValueOnce(response(account));
  await act(async () => { root.render(<Harness />); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("ChatGPT account lifecycle", () => {
  it("deduplicates overlapping focus and status refreshes", async () => {
    await mount();
    const pending = deferred<Response>();
    request.mockReturnValueOnce(pending.promise);
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => { first = controller.refresh(); second = controller.refresh(); });
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve(response(signedIn)); await Promise.all([first, second]); });
    expect(controller.loading).toBe(false);
  });

  it("does not let a stale authenticated response reopen the app after logout", async () => {
    await mount();
    const stale = deferred<Response>();
    request.mockReturnValueOnce(stale.promise);
    let refresh!: Promise<void>;
    await act(async () => { refresh = controller.refresh(); });
    request.mockResolvedValueOnce(response({ warning: null })).mockResolvedValueOnce(response(signedOut));
    await act(async () => { await controller.logout(); });
    await act(async () => { stale.resolve(response(signedIn)); await refresh; });
    expect(controller.account?.authenticated).toBe(false);
    expect(controller.loading).toBe(false);
  });

  it("keeps the workspace locked when the status request after logout fails", async () => {
    await mount();
    request.mockResolvedValueOnce(response({ warning: "Remote disconnect was not confirmed." })).mockRejectedValueOnce(new Error("Backend unavailable"));
    await act(async () => { await controller.logout(); });
    expect(controller.account).toBeNull();
    expect(controller.error).toBe("Backend unavailable");
    expect(controller.warning).toBe("Remote disconnect was not confirmed.");
  });

  it("locks the workspace if the account can no longer be verified", async () => {
    await mount();
    request.mockRejectedValueOnce(new Error("Account verification failed"));
    await act(async () => { await controller.refresh(); });
    expect(controller.account).toBeNull();
    expect(controller.error).toBe("Account verification failed");
  });

  it("creates one login for repeated clicks and surfaces external-browser failures", async () => {
    await mount(signedOut);
    const login = deferred<Response>();
    const openExternal = vi.fn().mockRejectedValue(new Error("Browser could not open"));
    window.clewDesktop = { apiBase: "clew://app", sessionToken: "test", platform: "linux", version: "1.0.0", openExternal, exportObsidian: vi.fn() };
    request.mockReturnValueOnce(login.promise);
    let first!: Promise<void>;
    await act(async () => { first = controller.login(); void controller.login(); });
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => { login.resolve(response({ loginId: "one", authUrl: "https://auth.openai.com/authorize" })); await first; });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(controller.account?.login?.loginId).toBe("one");
    expect(controller.error).toBe("Browser could not open");
    delete window.clewDesktop;
  });

  it("does not start OAuth when the browser blocks the popup", async () => {
    await mount(signedOut);
    vi.spyOn(window, "open").mockReturnValueOnce(null);
    await act(async () => { await controller.login(); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.error).toContain("Allow popups");
    vi.restoreAllMocks();
  });

  it("keeps polling while the callback is completing and opens the workspace without another focus event", async () => {
    vi.useFakeTimers();
    try {
      await mount({ ...signedOut, login: { loginId: "finishing", authUrl: "https://auth.openai.com/authorize", phase: "completing" } });
      request.mockResolvedValueOnce(response(signedIn));
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(controller.account?.authenticated).toBe(true);
      expect(controller.account?.login).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
