import OpenAI from "openai";
import { OPENROUTER_BASE_URL, LLM_MODEL, LLM_MAX_TOKENS, LLM_MAX_INPUT_CHARS } from "@newshog/shared";
import type { Angle, ContentKind, PostPlatform } from "@newshog/shared";
import { recordLlmCall } from "@newshog/db";
import { loadPrompt } from "./prompts";

const client = new OpenAI({
  baseURL: OPENROUTER_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY!,
});

export interface ContentInput {
  articleTitle?: string | null;
  articleText?: string | null;
  angles: Angle[];
  selectedAngle?: string;
  profileContext?: string;
  opportunity?: { requesterName?: string; outlet?: string; topicText: string };
  analysisId?: string;

  // blog/post feed — the same fields analysis.md exposes, so the time-framing
  // and fit logic in blog.md/post.md has what it needs (Step 1/2 there).
  analysis?: {
    score?: number | null;
    velocity?: string | null;
    eventTiming?: string | null;
    whyNow?: string | null;
    sourcePublishedAt?: string | null;
  };
  researchContext?: string;
  platform?: PostPlatform;
}

export type ContentKind2 = ContentKind;

// prompt file per kind — "post" maps to posts.md (plural), matching the repo.
const PROMPT_FILES: Record<ContentKind, string> = { pitch: "pitch.md", blog: "blog.md", post: "posts.md" };

export async function generateContent(kind: ContentKind, input: ContentInput): Promise<string> {
  const angle =
    input.angles.find((a) => a.title === input.selectedAngle) ??
    input.angles[0];

  const angleBlock = angle
    ? `Selected angle:\nTitle: ${angle.title}\nWhy now: ${angle.why_now}\nWhy journalists care: ${angle.why_journalists_care}\nExample headline: ${angle.headline}`
    : "No angles available — reflect what the article supports.";

  const titleLine = input.articleTitle ? `Article title: ${input.articleTitle}\n\n` : "";
  const textBlock = (input.articleText ?? "").slice(0, LLM_MAX_INPUT_CHARS);
  const profileBlock = input.profileContext
    ? `\n\nUser profile context:\n${input.profileContext}`
    : "";
  const requestBlock =
    kind === "pitch" && input.opportunity
      ? `\n\nMatched journalist request: ${input.opportunity.requesterName ?? "unknown"} at ${input.opportunity.outlet ?? "unknown outlet"}. They asked: ${input.opportunity.topicText}`
      : "";
  const researchBlock = input.researchContext ? `\n\nResearch context:\n${input.researchContext}` : "";
  const analysisBlock =
    kind === "pitch" || !input.analysis
      ? ""
      : `\n\nArticle analysis:\n` +
        `score: ${input.analysis.score ?? "n/a"}/100\n` +
        `velocity: ${input.analysis.velocity ?? "n/a"}\n` +
        `event_timing: ${input.analysis.eventTiming ?? "n/a"}\n` +
        `why_this_matters: ${input.analysis.whyNow ?? "n/a"}\n` +
        `article_published_at: ${input.analysis.sourcePublishedAt ?? "unknown"}\n` +
        `current_date: ${new Date().toISOString().slice(0, 10)}` +
        (input.platform ? `\nplatform: ${input.platform}` : "");

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    messages: [
      { role: "system", content: loadPrompt(PROMPT_FILES[kind]) },
      {
        role: "user",
        content: `${titleLine}${angleBlock}\n\nArticle text:\n${textBlock}${analysisBlock}${profileBlock}${researchBlock}${requestBlock}`,
      },
    ],
  });

  const content = response.choices[0]?.message.content?.trim();
  if (!content) throw new Error(`No ${kind} generated`);

  await recordLlmCall(kind, response.usage, input.analysisId);
  return content;
}

// Backward-compatible wrapper: existing callers/tests use generatePitch().
export function generatePitch(input: Omit<ContentInput, "analysis" | "researchContext" | "platform">): Promise<string> {
  return generateContent("pitch", input);
}

export interface ContentMeta {
  fitAssessment?: string;
  fitNote?: string | null;
  timeFraming?: string;
  title?: string;
}

// Safety net on top of the prompt rules: even a well-instructed model
// occasionally prefaces content with a meta line ("Here is a LinkedIn post…",
// "Sure, here's…"). Strip only the FIRST non-empty line when it's that framing
// so the pasted draft is content-only. To avoid eating a legit hook, only
// strip when the line terminates with a colon or ellipsis — a bare
// "This is the pitch I used…" opening line is a real take and stays.
const PREAMBLE_RE = /^(here(?:'s|’s| is)|this is (?:a|the)|below is|i(?:'ve| have) (?:prepared|written|drafted)|as requested,? here|sure,? here|okay,? here|certainly|absolutely)\b/i;

export function stripPreamble(text: string): string {
  let lines = text.replace(/\r\n/g, "\n").trim().split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  const first = lines[0]?.trim() ?? "";
  if (lines.length && PREAMBLE_RE.test(first) && /:$|…$|\.\.\.$/.test(first)) lines.shift();
  return lines.join("\n").trim();
}

// blog/post prompts emit one JSON object (see Output schema in blog.md and
// posts.md). Turn it into editable text + the one-shot safety flags. Falls
// back to the raw string when the model skips the schema — a quoted sentence
// is still pasteable, just without the banner.
// Models emit pretty-printed JSON with real line breaks inside string values
// (invalid JSON). Before parsing, replace raw newlines that fall inside a
// string (tracking escape state) with \n so multi-paragraph bodies survive.
function repairLooseJson(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === "\n" || ch === "\r") { out += "\\n"; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    out += ch;
  }
  return out;
}

// Models also drop the backslash before dialog/punctuation quotes inside a
// string («a novel "semantic search" approach»), which breaks JSON.parse.
// Repair: inside a string, a `"` is a real closing quote only when it's
// followed by whitespace/end then a JSON structural char (`, : } ]`). Any
// other `"` is literal prose — escape it and keep scanning. Validated by
// JSON.parse in tryParse, so a misjudged quote fails loudly to the next
// candidate rather than silently corrupting.
function repairUnescapedQuotes(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const next = s[j];
        if (next === "," || next === "}" || next === "]" || next === ":" || next === undefined) {
          inStr = false;
          out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      if (ch === "\n" || ch === "\r") { out += "\\n"; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    out += ch;
  }
  return out;
}

function tryParse(raw: string): Record<string, unknown> | null {
  const repaired = repairLooseJson(raw);
  for (const candidate of [raw, repaired, repairUnescapedQuotes(repaired)]) {
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === "object") return obj as Record<string, unknown>;
    } catch {
      // try next
    }
  }
  return null;
}

export function parseContentResult(kind: ContentKind, raw: string): { text: string; meta: ContentMeta | null } {
  if (kind === "pitch") return { text: stripPreamble(raw), meta: null };

  let obj: Record<string, unknown> | null = null;
  const direct = raw.match(/^\{[^]*\}$/);
  if (direct) obj = tryParse(direct[0]);
  if (!obj) {
    const fenced = raw.match(/\{[\s\S]*\}/);
    if (fenced) obj = tryParse(fenced[0]);
  }

  if (!obj) return { text: stripPreamble(raw), meta: null };

  const meta: ContentMeta = {
    fitAssessment: typeof obj.fit_assessment === "string" ? obj.fit_assessment : undefined,
    fitNote: typeof obj.fit_note === "string" ? obj.fit_note : null,
    timeFraming: typeof obj.time_framing === "string" ? obj.time_framing : undefined,
    title: typeof obj.title === "string" ? obj.title : undefined,
  };

  const body = typeof obj.body === "string" ? stripPreamble(obj.body) : undefined;
  const post = typeof obj.post === "string" ? stripPreamble(obj.post) : undefined;

  const text =
    kind === "blog"
      ? `${meta.title ? `${meta.title}\n\n` : ""}${body ?? raw}`
      : post ?? raw;

  return { text, meta };
}