import { Queue } from "bullmq";
import IORedis from "ioredis";

export const ANALYZE_QUEUE = "analyze";
export const EMAIL_INGEST_QUEUE = "email-ingest";
export const MATCH_QUEUE = "match";

export function createConnection() {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}

let analyzeQueue: Queue | undefined;
let emailIngestQueue: Queue | undefined;
let matchQueue: Queue | undefined;

export function getAnalyzeQueue(): Queue {
  if (!analyzeQueue) {
    analyzeQueue = new Queue(ANALYZE_QUEUE, { connection: createConnection() });
  }
  return analyzeQueue;
}

export function getEmailIngestQueue(): Queue {
  if (!emailIngestQueue) {
    emailIngestQueue = new Queue(EMAIL_INGEST_QUEUE, { connection: createConnection() });
  }
  return emailIngestQueue;
}

export function getMatchQueue(): Queue {
  if (!matchQueue) {
    matchQueue = new Queue(MATCH_QUEUE, { connection: createConnection() });
  }
  return matchQueue;
}
