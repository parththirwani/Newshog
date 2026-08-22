import { Queue } from "bullmq";
import IORedis from "ioredis";

export const ANALYZE_QUEUE = "analyze";

export function createConnection() {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}

let queue: Queue | undefined;

export function getAnalyzeQueue(): Queue {
  if (!queue) {
    queue = new Queue(ANALYZE_QUEUE, { connection: createConnection() });
  }
  return queue;
}
