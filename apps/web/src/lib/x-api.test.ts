import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { normalizeXHandle, fetchXProfile } from "./x-api";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { loadCachedXProfile, saveCachedXProfile } = vi.hoisted(() => ({
  loadCachedXProfile: vi.fn(),
  saveCachedXProfile: vi.fn(),
}));
vi.mock("./x-profile-cache", () => ({ loadCachedXProfile, saveCachedXProfile }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  loadCachedXProfile.mockReset().mockResolvedValue(null);
  saveCachedXProfile.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeXHandle", () => {
  it("strips scheme, domain, @, query and trailing slash", () => {
    expect(normalizeXHandle("x.com/Parth_Thirwani")).toBe("Parth_Thirwani");
    expect(normalizeXHandle("https://x.com/Parth_Thirwani")).toBe("Parth_Thirwani");
    expect(normalizeXHandle("https://twitter.com/Parth_Thirwani?s=20")).toBe("Parth_Thirwani");
    expect(normalizeXHandle("https://www.twitter.com/@Parth_Thirwani")).toBe("Parth_Thirwani");
    expect(normalizeXHandle("@Parth_Thirwani")).toBe("Parth_Thirwani");
    expect(normalizeXHandle("Parth_Thirwani/")).toBe("Parth_Thirwani");
  });
});

function userResponse(bio: string): Response {
  return { ok: true, status: 200, json: async () => ({ data: { id: "123", description: bio } }) } as unknown as Response;
}

function tweetsResponse(texts: string[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: texts.map((t) => ({ text: t })) }),
  } as unknown as Response;
}

describe("fetchXProfile", () => {
  it("reports no_token instead of silently returning null", async () => {
    delete process.env.X_API_KEY;
    const res = await fetchXProfile("Parth_Thirwani");
    expect(res).toEqual({ ok: false, reason: "no_token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid handle", async () => {
    process.env.X_API_KEY = "tok";
    const res = await fetchXProfile("not a valid handle!");
    expect(res).toEqual({ ok: false, reason: "bad_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes not_found from api_error", async () => {
    process.env.X_API_KEY = "tok";
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);
    expect(await fetchXProfile("ghost_user_xyz")).toEqual({ ok: false, reason: "not_found" });
    expect(saveCachedXProfile).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ ok: false, status: 403 } as Response);
    expect(await fetchXProfile("Parth_Thirwani")).toEqual({ ok: false, reason: "api_error", status: 403 });
    expect(saveCachedXProfile).not.toHaveBeenCalled();
  });

  it("propagates rate limiting", async () => {
    process.env.X_API_KEY = "tok";
    fetchMock.mockResolvedValue({ ok: false, status: 429 } as Response);
    const res = await fetchXProfile("Parth_Thirwani");
    expect(res).toEqual({ ok: false, reason: "rate_limited", status: 429 });
  });

  it("fetches user then tweets with the normalized handle (max_results=5)", async () => {
    process.env.X_API_KEY = "tok";
    fetchMock
      .mockResolvedValueOnce(userResponse("Building Codemate."))
      .mockResolvedValueOnce(tweetsResponse(["tweet one", "tweet two"]));

    const res = await fetchXProfile("https://x.com/Parth_Thirwani");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.handle).toBe("Parth_Thirwani");
    expect(res.bio).toBe("Building Codemate.");
    expect(res.recentPosts).toEqual(["tweet one", "tweet two"]);

    const firstCall = fetchMock.mock.calls[0][0] as string;
    expect(firstCall).toContain("users/by/username/Parth_Thirwani");
    const secondCall = fetchMock.mock.calls[1][0] as string;
    expect(secondCall).toContain("max_results=5");

    // Full success is cached for the 24h window.
    expect(saveCachedXProfile).toHaveBeenCalledWith(
      "Parth_Thirwani",
      expect.objectContaining({ bio: "Building Codemate.", recentPosts: ["tweet one", "tweet two"] }),
    );
  });

  it("serves a cached profile within 24h without calling the X API", async () => {
    process.env.X_API_KEY = "tok";
    loadCachedXProfile.mockResolvedValue({
      handle: "Parth_Thirwani",
      bio: "cached bio",
      recentPosts: ["cached post"],
    });

    const res = await fetchXProfile("https://x.com/Parth_Thirwani");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveCachedXProfile).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, handle: "Parth_Thirwani", bio: "cached bio", recentPosts: ["cached post"] });
  });

  it("does not cache failures (handles not hit)", async () => {
    delete process.env.X_API_KEY;
    await fetchXProfile("Parth_Thirwani");
    expect(loadCachedXProfile).not.toHaveBeenCalled();
    expect(saveCachedXProfile).not.toHaveBeenCalled();
  });

  it("returns bio-only when the tweets endpoint fails (real user signal preserved, not cached)", async () => {
    process.env.X_API_KEY = "tok";
    fetchMock
      .mockResolvedValueOnce(userResponse("A bio."))
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    const res = await fetchXProfile("Parth_Thirwani");
    expect(res).toEqual({ ok: true, handle: "Parth_Thirwani", bio: "A bio.", recentPosts: [] });
    // Degraded result — a temporary tweets outage must not freeze empty posts for 24h.
    expect(saveCachedXProfile).not.toHaveBeenCalled();
  });

  it("preserves the bio when the tweets endpoint is rate-limited too", async () => {
    process.env.X_API_KEY = "tok";
    fetchMock
      .mockResolvedValueOnce(userResponse("A bio."))
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response);

    const res = await fetchXProfile("Parth_Thirwani");
    expect(res).toEqual({ ok: true, handle: "Parth_Thirwani", bio: "A bio.", recentPosts: [] });
    expect(saveCachedXProfile).not.toHaveBeenCalled();
  });
});