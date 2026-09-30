/**
 * M-FONTS-B preview strategy: lazy-load ONLY the previewed font — one
 * active download at a time (the deliberate-action principle: no
 * list-wide fetching, respect rate limits). A single-slot serial
 * queue; the dialog's preview flow enqueues its byte fetch through
 * this module so rapid preview-clicking can never overlap requests.
 */

let active: Promise<unknown> | null = null;
/** Test seam: how many waits the queue serialized. */
export const queueStats = { enqueued: 0, started: 0 };

export function enqueuePreview<T>(task: () => Promise<T>): Promise<T> {
  queueStats.enqueued += 1;
  const run = () => {
    queueStats.started += 1;
    return task();
  };
  if (!active) {
    active = run().finally(() => {
      active = null;
    });
    return active as Promise<T>;
  }
  // Serialize: the next task runs when the current one settles.
  const chained = active.then(run, run);
  active = chained.finally(() => {
    if (active === chained) active = null;
  });
  return chained as Promise<T>;
}

/** Test seam: reset between tests. */
export function resetPreviewQueue(): void {
  active = null;
  queueStats.enqueued = 0;
  queueStats.started = 0;
}
