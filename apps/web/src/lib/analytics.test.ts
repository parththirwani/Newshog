import { describe, it, expect } from "vitest";
import { isValidEventName, pruneProps, MAX_PROPS_LEN } from "./analytics";

describe("isValidEventName", () => {
  it("accepts whitelisted event names", () => {
    for (const name of [
      "url_pasted",
      "analysis_completed",
      "angle_copied",
      "pitch_copied",
      "result_shared",
    ]) {
      expect(isValidEventName(name)).toBe(true);
    }
  });

  it("rejects unknown event names", () => {
    expect(isValidEventName("hacker_event")).toBe(false);
    expect(isValidEventName("")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isValidEventName(null)).toBe(false);
    expect(isValidEventName(42)).toBe(false);
    expect(isValidEventName(undefined)).toBe(false);
  });
});

describe("pruneProps", () => {
  it("keeps only primitive string/number/boolean/null values", () => {
    expect(
      pruneProps({ angle: "A", score: 3, ok: true, skip: null, nested: { x: 1 }, list: [1] }),
    ).toEqual({ angle: "A", score: 3, ok: true, skip: null });
  });

  it("caps props at MAX_PROPS_LEN", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < MAX_PROPS_LEN + 5; i++) wide[`k${i}`] = i;
    const out = pruneProps(wide)!;
    expect(Object.keys(out)).toHaveLength(MAX_PROPS_LEN);
  });

  it("returns undefined for empty, arrays, and non-objects", () => {
    expect(pruneProps({})).toBeUndefined();
    expect(pruneProps([1, 2])).toBeUndefined();
    expect(pruneProps(null)).toBeUndefined();
    expect(pruneProps("nope")).toBeUndefined();
  });
});