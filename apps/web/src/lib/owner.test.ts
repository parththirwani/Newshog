import { describe, it, expect } from "vitest";
import { isProfileOwner } from "./owner";

describe("isProfileOwner", () => {
  it("treats context-free analyses as public (owner-less)", () => {
    expect(isProfileOwner(null, null)).toBe(true);
    expect(isProfileOwner(undefined, "any")).toBe(true);
  });

  it("grants ownership when the profile ids match", () => {
    expect(isProfileOwner("profile-1", "profile-1")).toBe(true);
  });

  it("denies ownership when the profile ids differ", () => {
    expect(isProfileOwner("profile-1", "profile-2")).toBe(false);
  });

  it("denies ownership when no session profile exists", () => {
    expect(isProfileOwner("profile-1", null)).toBe(false);
  });
});