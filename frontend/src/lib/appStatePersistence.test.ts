// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ASSISTANT_WIDTH_STORAGE_KEY } from "./appContracts";
import { readStoredAssistantWidth, readStoredBoolean } from "./appStatePersistence";
beforeEach(() => localStorage.clear());
describe("workspace preference persistence", () => {
  it("restores valid fractional widths without truncating persisted state", () => {
    localStorage.setItem(ASSISTANT_WIDTH_STORAGE_KEY, "390.75");
    expect(readStoredAssistantWidth()).toBe(390.75);
  });
  it("rejects partial and non-finite numeric preferences", () => {
    for (const value of ["390junk", "Infinity", "NaN", "   "]) {
      localStorage.setItem(ASSISTANT_WIDTH_STORAGE_KEY, value);
      expect(readStoredAssistantWidth()).toBe(390);
    }
  });
  it("retains the existing collapsed-width and upper-bound rules", () => {
    for (const [value, expected] of [["0", 0], ["279", 0], ["280", 280], ["999", 620]] as const) {
      localStorage.setItem(ASSISTANT_WIDTH_STORAGE_KEY, value);
      expect(readStoredAssistantWidth()).toBe(expected);
    }
    localStorage.setItem("bool", "true");
    expect(readStoredBoolean("bool", false)).toBe(false);
  });
});
