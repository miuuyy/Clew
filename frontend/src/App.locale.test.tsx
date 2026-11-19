// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { apiFetch } from "./lib/apiRequest";
import { readAppLocale } from "./lib/appLocale";

vi.mock("./lib/apiRequest", () => ({ apiFetch: vi.fn() }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
  vi.mocked(apiFetch).mockImplementation(async () =>
    new Response(JSON.stringify({ authenticated: false, sharing: false, models: [] })),
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  const initialLocale = await readAppLocale();
  await act(async () => root.render(<App initialLocale={initialLocale} />));
}

async function selectLanguage(locale: string) {
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = locale;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("changes the sign-in screen and document language and saves the selection", async () => {
  await mount();
  expect(container.textContent).toContain("Continue with ChatGPT");

  await selectLanguage("zh-CN");
  expect(container.textContent).toContain("使用 ChatGPT 继续");
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(document.title).toBe("Clew 工作区");
  const [, request] = vi.mocked(apiFetch).mock.lastCall!;
  expect(new Headers(request?.headers).get("Accept-Language")).toBe("zh-CN");

  await act(async () => root.unmount());
  root = createRoot(container);
  await mount();
  expect(container.querySelector("select")?.value).toBe("zh-CN");
});

it("uses Simplified Chinese on a Chinese system with no saved choice", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-Hans-CN"]);
  await mount();
  expect(container.querySelector("select")?.value).toBe("zh-CN");
  await selectLanguage("en");
  expect(await readAppLocale()).toBe("en");
});
