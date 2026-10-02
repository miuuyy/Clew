import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./apiRequest";

afterEach(() => vi.unstubAllGlobals());
describe("desktop request isolation", () => {
  it.each(["https://example.test/api/v1/workspace/current", "other://app/api/v1/workspace/current", "clew://other/api/v1/workspace/current", "clew://app/clew-mark.svg"])("does not send a launch credential to %s", async (url) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { clewDesktop: { apiBase: "clew://app", sessionToken: "local-only" } });
    await expect(apiFetch(url)).rejects.toThrow("local API");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("adds the launch credential to the owned API", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { clewDesktop: { apiBase: "clew://app", sessionToken: "local-only" } });
    await apiFetch("clew://app/api/v1/workspace/current");
    expect(fetch.mock.calls[0][0].headers.get("X-Clew-Session")).toBe("local-only");
  });
});
