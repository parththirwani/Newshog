import type { ClarificationQuestion, Learning } from "./types";

type Clarification = ClarificationQuestion;

/**
 * Extract a single JSON object from model text. Strips code fences, then does a
 * brace-matching scan so JSON wrapped in prose or a ```json block still parses.
 */
export function extractJsonObject(text: string): Record<string, unknown> {
  const normalized = String(text ?? "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  const start = normalized.indexOf("{");
  if (start === -1) throw new Error("The LLM response did not contain JSON.");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < normalized.length; index++) {
    const character = normalized[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      return JSON.parse(normalized.slice(start, index + 1)) as Record<string, unknown>;
    }
  }
  throw new Error("The LLM response contained incomplete JSON.");
}

function stringList(value: unknown, field: string, maximum: number): string[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${field} to be an array.`);
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => (item as string).trim())
    .slice(0, maximum);
}

export function parseResearchPlan(text: string): Array<{ query: string; researchGoal: string }> {
  const result = extractJsonObject(text);
  if (!Array.isArray(result.queries)) throw new Error("Expected queries to be an array.");
  const queries = result.queries
    .filter((item) => typeof (item as { query?: string }).query === "string" && (item as { query: string }).query.trim())
    .map((item) => ({
      query: (item as { query: string }).query.trim(),
      researchGoal: String((item as { researchGoal?: string }).researchGoal ?? (item as { query: string }).query).trim(),
    }))
    .slice(0, 6);
  if (queries.length === 0) throw new Error("The research plan did not include a usable query.");
  return queries;
}

/**
 * Parse learnings, enforce the citation allowlist, and keep the supporting
 * excerpt the model quoted for each claim (grounding for the enforcement gate
 * in Verify.ts).
 */
export function parseLearnings(text: string, allowedSourceUrls: string[] = []): {
  learnings: Learning[];
  followUpQuestions: string[];
} {
  const result = extractJsonObject(text);
  if (!Array.isArray(result.learnings)) throw new Error("Expected learnings to be an array.");
  const allowedUrls = new Set(allowedSourceUrls);
  const learnings = result.learnings
    .filter((item) => typeof (item as { text?: string }).text === "string" && (item as { text: string }).text.trim())
    .map((item) => {
      const entry = item as { text: string; sourceUrls?: unknown; excerpt?: unknown };
      const excerpt = typeof entry.excerpt === "string" ? entry.excerpt.trim().slice(0, 4000) : undefined;
      return {
        text: entry.text.trim(),
        sourceUrls: [...new Set<string>(Array.isArray(entry.sourceUrls) ? (entry.sourceUrls as string[]) : [])]
          .filter((url) => typeof url === "string" && allowedUrls.has(url))
          .slice(0, 5),
        ...(excerpt ? { excerpt } : {}),
      };
    })
    .filter((item) => item.sourceUrls.length > 0)
    .slice(0, 8);

  return {
    learnings,
    followUpQuestions: stringList(result.followUpQuestions, "followUpQuestions", 6),
  };
}

export function parseClarificationQuestions(text: string): Clarification[] {
  const result = extractJsonObject(text);
  if (!Array.isArray(result.questions)) throw new Error("Expected questions to be an array.");

  const usedIds = new Set<string>();
  const questions = result.questions
    .filter((item) => typeof (item as { question?: string }).question === "string" && (item as { question: string }).question.trim())
    .map((item, index) => {
      const raw = item as { id?: string; question: string };
      const candidate = String(raw.id ?? `question_${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
      const id = candidate && !usedIds.has(candidate) ? candidate : `question_${index + 1}`;
      usedIds.add(id);
      return { id, question: raw.question.trim().slice(0, 500) };
    })
    .slice(0, 4);

  if (questions.length < 2) throw new Error("The clarification response did not include enough usable questions.");
  return questions;
}

/**
 * Parse the sub-question planning step: 2-3 independent angles, or linear.
 * independent=false means the query does not decompose and should run as one thread.
 */
export function parseSubQuestionPlan(text: string): { threads: string[]; independent: boolean } {
  const result = extractJsonObject(text);
  if (result.independent !== false) {
    const threads = stringList(result.threads, "threads", 3);
    if (threads.length > 0) return { threads, independent: true };
  }
  const single = typeof result.query === "string" ? result.query.trim() : "";
  if (!single) throw new Error("The sub-question plan included no usable angles.");
  return { threads: [single], independent: false };
}