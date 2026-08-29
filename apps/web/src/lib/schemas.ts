// Zod request-body validation (security.md Phase A.4). One parseBody() used
// by every POST/PUT route: hard byte cap on the raw body (chunked requests
// included — the cap is enforced while streaming, not via the forgeable
// Content-Length alone), strict shape, and a uniform 400 shape:
//   { error: <human message>, code: "invalid_request" }
// Distinct from 429 rate_limited and 503 ratelimit_unavailable (A.1), and
// from the quota layer's 429 quota_exceeded.

import { NextResponse } from "next/server";
import { z } from "zod";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function httpUrl(message: string) {
  return z
    .string()
    .max(2048, message)
    .refine(isHttpUrl, message);
}

// The profile UI always posts every field, with "" for inputs the user left
// blank — "" means "absent/clear" (legacy behavior), so it passes as a valid
// empty value instead of tripping the URL shape check.
function optionalUrlOrEmpty(message: string) {
  return z.union([z.literal(""), httpUrl(message)]).optional();
}

const emailString = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Invalid email.");

export const AnalyzeBodySchema = z
  .object({
    url: httpUrl("Invalid URL. Provide a valid http(s) URL."),
    profileId: z.string().min(1).max(64).optional(),
  })
  .strict();

export const DeepAnalyzeBodySchema = z
  .object({
    url: httpUrl("Invalid URL. Provide a valid http(s) URL."),
  })
  .strict();

export const PrepareBodySchema = z
  .object({
    query: z.string().trim().min(1, "query must be a string between 1 and 8000 characters.").max(8000, "query must be a string between 1 and 8000 characters."),
  })
  .strict();

export const DeepResearchBodySchema = z
  .object({
    query: z.string().trim().min(1, "query must be a string between 1 and 8000 characters.").max(8000, "query must be a string between 1 and 8000 characters."),
    depth: z.number().int("depth must be an integer between 1 and 4.").min(1, "depth must be an integer between 1 and 4.").max(4, "depth must be an integer between 1 and 4.").default(2),
    breadth: z.number().int("breadth must be an integer between 1 and 6.").min(1, "breadth must be an integer between 1 and 6.").max(6, "breadth must be an integer between 1 and 6.").default(3),
    mode: z.enum(["answer", "report"], { message: "mode must be answer or report." }).default("answer"),
    prepareSessionId: z.string().min(1).max(64).optional(),
    skipClarification: z.boolean().default(false),
    clarificationAnswers: z.array(z.unknown()).default([]),
  })
  .strict();

export const AuthRequestBodySchema = z
  .object({
    email: emailString,
  })
  .strict();

export const AuthVerifyBodySchema = z
  .object({
    email: emailString,
    code: z.string().regex(/^\d{6}$/, "Invalid or expired code."),
  })
  .strict();

const optionalProfileFields = {
  linkedinUrl: optionalUrlOrEmpty("Invalid LinkedIn URL."),
  xHandle: z
    .union([z.literal(""), z.string().regex(/^[A-Za-z0-9_]{1,15}$/, "Invalid X handle.")])
    .optional(),
  freeTextBio: z.string().max(8000, "Bio is too long (max 8000 characters).").optional(),
  companyName: z.string().trim().min(1, "companyName required.").max(200).optional(),
  companyDescription: z.string().max(20000).optional(),
  websiteUrl: optionalUrlOrEmpty("Invalid website URL."),
  docsUrl: optionalUrlOrEmpty("Invalid docs URL."),
  // Text extracted client-side from the (10MB-capped) PDF upload.
  pdfText: z.string().max(2_000_000).optional(),
};

export const ProfileCreateBodySchema = z
  .object({
    type: z.enum(["individual", "enterprise"], { message: "type must be 'individual' or 'enterprise'." }),
    ...optionalProfileFields,
  })
  .strict();

export const ProfileUpdateBodySchema = z.object(optionalProfileFields);

export type ParseBodyOk<T> = { ok: true; data: T };
export type ParseBodyErr = { ok: false; response: NextResponse };

async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const body = request.body;
  if (!body || typeof (body as ReadableStream).getReader !== "function") {
    const text = await request.text();
    return text.length > maxBytes ? null : text;
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  opts: { maxBytes?: number } = {},
): Promise<ParseBodyOk<T> | ParseBodyErr> {
  const fail = (error: string): ParseBodyErr => ({
    ok: false,
    response: NextResponse.json({ error, code: "invalid_request" }, { status: 400 }),
  });

  const text = await readBodyCapped(request, opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES);
  if (text === null) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "payload_too_large", code: "invalid_request" },
        { status: 413 },
      ),
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("Invalid JSON body.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid request body.");
  }
  return { ok: true, data: parsed.data };
}
