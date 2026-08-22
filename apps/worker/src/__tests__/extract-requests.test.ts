import { describe, it, expect, vi, beforeEach } from "vitest";

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
const { extractJournalistRequests } = await import("../extract-requests");

function makeToolResponse(args: object) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            { function: { name: "submit_requests", arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}

describe("extractJournalistRequests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts multiple requests from digest email", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse({
        requests: [
          {
            requester_name: "Jane Smith",
            outlet: "TechCrunch",
            topic_text: "Looking for AI startup founders to comment on new funding trends",
            deadline: "2026-08-25",
            reply_contact: "jane@techcrunch.com",
          },
          {
            requester_name: "Bob Jones",
            outlet: "Forbes",
            topic_text: "Sources needed on cybersecurity regulations impact",
            deadline: null,
            reply_contact: null,
          },
        ],
      }),
    );

    const results = await extractJournalistRequests("digest email body");

    expect(results).toHaveLength(2);
    expect(results[0].requester_name).toBe("Jane Smith");
    expect(results[0].outlet).toBe("TechCrunch");
    expect(results[0].topic_text).toContain("AI startup founders");
    expect(results[1].requester_name).toBe("Bob Jones");
    expect(results[1].outlet).toBe("Forbes");
  });

  it("returns empty array when email has no journalist requests", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse({ requests: [] }),
    );

    const results = await extractJournalistRequests("promotional email");

    expect(results).toEqual([]);
  });

  it("returns empty array when no tool call in response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { tool_calls: [] } }],
    });

    const results = await extractJournalistRequests("email body");

    expect(results).toEqual([]);
  });

  it("returns empty array when tool arguments are invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: "submit_requests", arguments: "not-json" } },
            ],
          },
        },
      ],
    });

    const results = await extractJournalistRequests("email body");

    expect(results).toEqual([]);
  });

  it("handles null fields gracefully", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse({
        requests: [
          {
            requester_name: null,
            outlet: null,
            topic_text: "Looking for SaaS experts",
            deadline: null,
            reply_contact: null,
          },
        ],
      }),
    );

    const results = await extractJournalistRequests("body");

    expect(results).toHaveLength(1);
    expect(results[0].requester_name).toBeNull();
    expect(results[0].outlet).toBeNull();
    expect(results[0].topic_text).toBe("Looking for SaaS experts");
  });

  it("truncates email body to 6000 chars", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse({ requests: [] }),
    );

    const longBody = "x".repeat(10_000);
    await extractJournalistRequests(longBody);

    const messages = mockCreate.mock.calls[0][0].messages;
    const sentText = messages[1].content as string;
    expect(sentText.length).toBe(6000);
  });

  it("sends correct system message with extraction instructions", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse({ requests: [] }),
    );

    await extractJournalistRequests("body");

    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("journalist requests");
    expect(messages[0].content).toContain("source queries");
  });

  it("uses forced tool_choice for structured output", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse({ requests: [] }),
    );

    await extractJournalistRequests("body");

    const params = mockCreate.mock.calls[0][0];
    expect(params.tool_choice).toEqual({
      type: "function",
      function: { name: "submit_requests" },
    });
    expect(params.tools).toHaveLength(1);
    expect(params.tools[0].function.name).toBe("submit_requests");
  });

  it("handles requests with missing optional fields", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse({
        requests: [
          { topic_text: "minimal request" },
        ],
      }),
    );

    const results = await extractJournalistRequests("body");

    expect(results).toHaveLength(1);
    expect(results[0].topic_text).toBe("minimal request");
    expect(results[0].requester_name).toBeUndefined();
    expect(results[0].outlet).toBeUndefined();
    expect(results[0].deadline).toBeUndefined();
    expect(results[0].reply_contact).toBeUndefined();
  });
});
