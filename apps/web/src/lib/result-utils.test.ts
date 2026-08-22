import { describe, it, expect } from "vitest";
import { band, relativeTime } from "./result-utils";

describe("band", () => {
  it("maps scores below low threshold to Skip", () => {
    expect(band(0)).toBe("Skip");
    expect(band(29)).toBe("Skip");
  });

  it("maps mid scores to Consider", () => {
    expect(band(30)).toBe("Consider");
    expect(band(59)).toBe("Consider");
  });

  it("maps high scores to Strong", () => {
    expect(band(60)).toBe("Strong");
    expect(band(100)).toBe("Strong");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-08-22T12:00:00Z").getTime();

  it("reports minutes in the first hour", () => {
    expect(relativeTime("2026-08-22T11:59:30Z", now)).toBe("1m ago");
    expect(relativeTime("2026-08-22T11:30:00Z", now)).toBe("30m ago");
  });

  it("returns at least 1m for anything in the past minute", () => {
    expect(relativeTime("2026-08-22T11:59:59Z", now)).toBe("1m ago");
  });

  it("reports hours before a day passes", () => {
    expect(relativeTime("2026-08-22T10:00:00Z", now)).toBe("2h ago");
    expect(relativeTime("2026-08-21T17:00:00Z", now)).toBe("19h ago");
  });

  it("reports days after 24 hours", () => {
    expect(relativeTime("2026-08-19T12:00:00Z", now)).toBe("3d ago");
  });
});