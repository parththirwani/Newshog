import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isProUser, proGatingEnabled } from "./pro-gate";

const KEY = "ENABLE_PRO_GATING";

describe("pro-gate", () => {
  beforeEach(() => delete process.env[KEY]);
  afterEach(() => delete process.env[KEY]);

  it("is disabled by default (test/dev passes everyone through)", () => {
    expect(proGatingEnabled()).toBe(false);
    expect(isProUser({ tier: "free" })).toBe(true);
    expect(isProUser(null)).toBe(true);
  });

  it("enforces tier when the env switch is on", () => {
    process.env[KEY] = "true";
    expect(proGatingEnabled()).toBe(true);
    expect(isProUser({ tier: "pro" })).toBe(true);
    expect(isProUser({ tier: "free" })).toBe(false);
    expect(isProUser(null)).toBe(false);
  });

  it("recognizes the 1 toggle form", () => {
    process.env[KEY] = "1";
    expect(proGatingEnabled()).toBe(true);
  });
});