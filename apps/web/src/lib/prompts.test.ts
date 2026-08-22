import { describe, it, expect } from "vitest";
import { loadPrompt } from "./prompts";

describe("loadPrompt", () => {
  it("resolves a prompt file from the repo root even when cwd is the app dir", () => {
    const content = loadPrompt("pitch.md");
    expect(content.length).toBeGreaterThan(50);
    expect(content).toContain("Subject:");
  });

  it("resolves the profile summary prompt", () => {
    const content = loadPrompt("profile-summary.md");
    expect(content).toContain("profile analyst");
  });

  it("throws on a missing prompt", () => {
    expect(() => loadPrompt("does-not-exist.md")).toThrow("Prompt not found");
  });
});