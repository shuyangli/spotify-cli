// Process-level pacer: serializes outbound API calls and enforces a minimum
// interval between any two consecutive requests. This protects us from
// blowing through Spotify's rolling 30-second per-app quota when commands are
// invoked in tight succession.

const DEFAULT_MIN_INTERVAL_MS = 250;

function readMinInterval(): number {
  const raw = process.env["SPOTIFY_CLI_MIN_INTERVAL_MS"];
  if (!raw) return DEFAULT_MIN_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_MIN_INTERVAL_MS;
  return parsed;
}

let chain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

/**
 * Acquires a slot in the request queue. Resolves once enough time has passed
 * since the previous request that the caller may safely fire its own.
 * Calls are serialized strictly in the order they invoke `acquireSlot`.
 */
export function acquireSlot(): Promise<void> {
  const minInterval = readMinInterval();
  const next = chain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, minInterval - (now - lastRequestAt));
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  // Swallow errors so one failure doesn't poison subsequent slots.
  chain = next.catch(() => {});
  return next;
}

/** Test-only: reset the pacer state. */
export function _resetPacerForTests(): void {
  chain = Promise.resolve();
  lastRequestAt = 0;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
