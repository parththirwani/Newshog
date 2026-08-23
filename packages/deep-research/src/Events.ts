import { randomUUID } from "node:crypto";

export interface ResearchEvent {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
}

export interface Emitter {
  runId: string;
  emit: (type: string, data?: Record<string, unknown>) => ResearchEvent;
}

export function preview(value: unknown, maxLength = 240): string {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

export function createEventEmitter(opts: { runId?: string; onEvent?: (event: ResearchEvent) => void } = {}): Emitter {
  const runId = opts.runId ?? randomUUID();
  let sequence = 0;
  return {
    runId,
    emit(type, data = {}) {
      const event: ResearchEvent = {
        id: randomUUID(),
        runId,
        sequence: ++sequence,
        timestamp: new Date().toISOString(),
        type,
        data,
      };
      opts.onEvent?.(event);
      return event;
    },
  };
}