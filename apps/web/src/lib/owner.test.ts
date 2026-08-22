import { describe, it, expect } from "vitest";
import { isOwner } from "./owner";

describe("isOwner", () => {
  it("treats context-free analyses as public (owner-less)", () => {
    expect(isOwner({ userId: null, profileId: null }, null, null)).toBe(true);
    expect(isOwner({ userId: undefined, profileId: undefined }, null, "any")).toBe(true);
  });

  it("grants ownership when the user ids match", () => {
    expect(isOwner({ userId: "user-1", profileId: null }, "user-1", null)).toBe(true);
  });

  it("denies ownership when the user ids differ", () => {
    expect(isOwner({ userId: "user-1", profileId: null }, "user-2", null)).toBe(false);
  });

  it("denies ownership when no session user exists", () => {
    expect(isOwner({ userId: "user-1", profileId: null }, null, null)).toBe(false);
  });

  it("falls back to profile ownership for legacy profile-linked analyses", () => {
    expect(isOwner({ userId: null, profileId: "profile-1" }, null, "profile-1")).toBe(true);
    expect(isOwner({ userId: null, profileId: "profile-1" }, null, "profile-2")).toBe(false);
  });
});