import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SignIn } from "./SignIn";
import type { ChatGPTAccountController } from "../hooks/useChatGPTAccount";

function render(overrides: Partial<ChatGPTAccountController> = {}) {
  vi.stubGlobal("window", {});
  const chatgpt = { account: null, loading: false, error: null, warning: null, refresh: vi.fn(), login: vi.fn(), logout: vi.fn(), cancelLogin: vi.fn(), ...overrides } as ChatGPTAccountController;
  return renderToStaticMarkup(<SignIn chatgpt={chatgpt} />);
}

describe("sign-in onboarding", () => {
  it("offers one entry action with optional support links", () => {
    const html = render();
    expect(html).toContain("Continue with ChatGPT");
    expect(html).toContain("https://github.com/miuuyy/Clew");
    expect(html).toContain("https://x.com/miu21590");
    expect(html).not.toContain("Skip");
    expect(html).not.toContain("checkbox");
  });
  it("shows a cancellable pending login instead of allowing a second attempt", () => {
    const html = render({ account: { authenticated: false, sharing: false, can_disconnect: false, connected: true, models: [], error: null, account: null, login: { loginId: "pending", authUrl: "https://auth.openai.com/authorize", phase: "pending" } } });
    expect(html).toContain("Finish signing in");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Continue with ChatGPT");
  });
  it("makes errors visible and retryable", () => {
    const html = render({ error: "Could not reach ChatGPT." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not reach ChatGPT.");
    expect(html).toContain("Try again");
  });
});
