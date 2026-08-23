/**
 * Bounded worker-pool parallel map. Cap concurrency at [1, items.length] so a
 * partially filled array can't spawn more workers than it has work.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const total = items.length;
  if (total === 0) return [];
  const effective = Math.max(Math.min(concurrency, total), 1);
  const results = new Array<R>(total);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= total) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: effective }, () => runWorker()));
  return results;
}

/**
 * Run an array of async thread-functions sharing ONE concurrency budget. This is
 * the fan-out primitive for parallel sub-question threads: the outer pool caps
 * total in-flight work to `budget`, so N threads do NOT multiply the budget.
 *
 * Contract for a thread function: it must not open its own nested wide pool —
 * callers fan out at the top, and inner research walks its queries sequentially
 * (or through an inner pool of 1). This keeps e.g. SEARCH_CONCURRENCY=2 a hard
 * global ceiling across all threads, as the plan requires.
 */
export async function runThreads<T>(
  threads: Array<() => Promise<T>>,
  budget: number,
): Promise<T[]> {
  const capped = Math.max(Math.min(budget, threads.length), 1);
  const results = new Array<T>(threads.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= threads.length) return;
      results[index] = await threads[index]();
    }
  }

  await Promise.all(Array.from({ length: capped }, () => runWorker()));
  return results;
}