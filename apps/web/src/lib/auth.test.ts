import { describe, it, expect } from "vitest";
import { sessionCookie, anonIdCookie, verifySigned, sign } from "./auth";

describe("signed cookies", () => {
  it("round-trips the email through a signed session cookie", () => {
    const cookie = sessionCookie("owner@example.com");
    expect(verifySigned(cookie.value)).toBe("owner@example.com");
  });

  it("round-trips an anon id through a signed cookie", () => {
    const cookie = anonIdCookie("abc123");
    expect(verifySigned(cookie.value)).toBe("abc123");
  });

  it("rejects a tampered value", () => {
    const cookie = sessionCookie("owner@example.com");
    expect(verifySigned(`${cookie.value}x`)).toBeNull();
  });

  it("rejects a re-signed value from another email (no signature swap)", () => {
    const evil = `${"attacker@example.com"}.${sign("owner@example.com")}`;
    expect(verifySigned(evil)).toBeNull();
  });

  it("rejects malformed cookie values", () => {
    expect(verifySigned("")).toBeNull();
    expect(verifySigned("no-separator")).toBeNull();
  });
});