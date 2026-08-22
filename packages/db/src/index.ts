import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Fire-and-forget LLM usage capture. Never throws — cost tracking must not
// break the LLM call that produced the usage.
export async function recordLlmCall(
  stage: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
  analysisId?: string | null,
): Promise<void> {
  try {
    await prisma.lLMCall.create({
      data: {
        stage,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        analysisId: analysisId ?? null,
      },
    });
  } catch (err) {
    console.error(`[recordLlmCall] ${stage} failed:`, err);
  }
}

// One-line JSON structured log for pipeline stages, greppable per analysis.
export function logStage(stage: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), stage, ...extra }));
}
