import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Angle, JournalistRequest } from "@newshog/shared";

vi.mock("openai", () => {
  const mockCreate = vi.fn();
  return {
    default: function MockOpenAI() {
      return { chat: { completions: { create: mockCreate } } };
    },
    __mockCreate: mockCreate,
  };
});

const { __mockCreate: mockCreate } = await import("openai");
const { matchRequestsToAnalysis } = await import("../match-requests");

function makeToolResponse(args: object) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            { function: { name: "submit_matches", arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}

const ANGLES: Angle[] = [
  {
    title: "AI startup funding",
    why_now: "Record quarter for AI investments",
    why_journalists_care: "Trend piece on funding patterns",
    headline: "AI Funding Hits Record High in Q3 2026",
  },
  {
    title: "Cybersecurity regulation",
    why_now: "New federal bill introduced",
    why_journalists_care: "Policy impact on tech companies",
    headline: "New Cybersecurity Bill Could Reshape Tech Compliance",
  },
];

const REQUESTS: JournalistRequest[] = [
  {
    id: "req-1",
    sourcePlatform: "source_of_sources",
    requesterName: "Jane Smith",
    outlet: "TechCrunch",
    topicText: "AI startup founders available for comment on funding trends",
    deadline: "2026-08-25",
    replyContact: "jane@techcrunch.com",
    ingestedAt: "2026-08-20T10:00:00Z",
  },
  {
    id: "req-2",
    sourcePlatform: "help_a_b2b_writer",
    requesterName: "Bob Jones",
    outlet: "Forbes",
    topicText: "Looking for cybersecurity experts on new federal regulations",
    deadline: "2026-08-28",
    replyContact: "bob@forbes.com",
    ingestedAt: "2026-08-20T11:00:00Z",
  },
  {
    id: "req-3",
    sourcePlatform: "sourcebottle",
    requesterName: "Alice Wong",
    outlet: "The Verge",
    topicText: "Seeking restaurant owners for piece on food delivery apps",
    deadline: "2026-08-30",
    replyContact: null,
    ingestedAt: "2026-08-20T12:00:00Z",
  },
];

describe("matchRequestsToAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no requests provided", async () => {
    const results = await matchRequestsToAnalysis(ANGLES, null, []);
    expect(results).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("matches relevant requests to angles", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse({
        matches: [
          { journalist_request_id: "req-1", match_rationale: "Angle 1 covers AI funding." },
          { journalist_request_id: "req-2", match_rationale: "Angle 2 covers cybersecurity." },
        ],
      }),
    );

    const results = await matchRequestsToAnalysis(ANGLES, null, REQUESTS);

    expect(results).toHaveLength(2);
    expect(results[0].journalist_request_id).toBe("req-1");
    expect(results[1].journalist_request_id).toBe("req-2");
  });

  it("returns empty array when no matches found", async () => {
    mockCreate.mockResolvedValue(makeToolResponse({ matches: [] }));
    const results = await matchRequestsToAnalysis(ANGLES, null, REQUESTS);
    expect(results).toEqual([]);
  });

  it("returns empty array when no tool call in response", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { tool_calls: [] } }] });
    const results = await matchRequestsToAnalysis(ANGLES, null, REQUESTS);
    expect(results).toEqual([]);
  });

  it("returns empty array on invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { tool_calls: [{ function: { name: "submit_matches", arguments: "bad" } }] } }],
    });
    const results = await matchRequestsToAnalysis(ANGLES, null, REQUESTS);
    expect(results).toEqual([]);
  });

  it("includes profile context when provided", async () => {
    mockCreate.mockResolvedValue(makeToolResponse({ matches: [] }));
    await matchRequestsToAnalysis(ANGLES, "Topics: AI, cybersecurity", REQUESTS);

    const userContent = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userContent).toContain("User profile:");
    expect(userContent).toContain("Topics: AI, cybersecurity");
  });

  it("omits profile section when null", async () => {
    mockCreate.mockResolvedValue(makeToolResponse({ matches: [] }));
    await matchRequestsToAnalysis(ANGLES, null, REQUESTS);

    const userContent = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userContent).not.toContain("User profile:");
  });

  it("formats angles with numbered list", async () => {
    mockCreate.mockResolvedValue(makeToolResponse({ matches: [] }));
    await matchRequestsToAnalysis(ANGLES, null, REQUESTS);

    const userContent = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userContent).toContain("1. AI startup funding:");
    expect(userContent).toContain("2. Cybersecurity regulation:");
  });

  it("formats requests with IDs and fallback labels", async () => {
    mockCreate.mockResolvedValue(makeToolResponse({ matches: [] }));
    await matchRequestsToAnalysis(ANGLES, null, REQUESTS);

    const userContent = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userContent).toContain("[req-1] Jane Smith (TechCrunch):");
    expect(userContent).toContain("[req-3] Alice Wong (The Verge):");
  });

  it("handles sparse request fields with fallbacks", async () => {
    const sparse: JournalistRequest[] = [
      { id: "req-x", sourcePlatform: "sourcebottle", topicText: "general query", ingestedAt: "2026-08-20T10:00:00Z" },
    ];
    mockCreate.mockResolvedValue(makeToolResponse({ matches: [] }));
    await matchRequestsToAnalysis(ANGLES, null, sparse);

    const userContent = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userContent).toContain("[req-x] Unknown (unknown outlet): general query");
  });

  it("uses forced tool_choice", async () => {
    mockCreate.mockResolvedValue(makeToolResponse({ matches: [] }));
    await matchRequestsToAnalysis(ANGLES, null, REQUESTS);

    const params = mockCreate.mock.calls[0][0];
    expect(params.tool_choice).toEqual({ type: "function", function: { name: "submit_matches" } });
  });

  it("sends system message with matching instructions", async () => {
    mockCreate.mockResolvedValue(makeToolResponse({ matches: [] }));
    await matchRequestsToAnalysis(ANGLES, null, REQUESTS);

    const systemContent = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemContent).toContain("match journalist open requests");
    expect(systemContent).toContain("Be selective");
  });

  it("handles empty angles array", async () => {
    mockCreate.mockResolvedValue(makeToolResponse({ matches: [] }));
    await matchRequestsToAnalysis([], null, REQUESTS);

    const userContent = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userContent).toContain("Angles:\n\n\nOpen journalist requests:");
  });

  it("preserves match_rationale from LLM", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse({
        matches: [{ journalist_request_id: "req-1", match_rationale: "Direct fit for AI angle." }],
      }),
    );

    const results = await matchRequestsToAnalysis(ANGLES, null, REQUESTS);
    expect(results[0].match_rationale).toBe("Direct fit for AI angle.");
  });
});
