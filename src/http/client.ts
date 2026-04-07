import { acquireSlot, sleep } from "./pacer.js";
import { SpotifyApiError } from "./errors.js";
import { getAccessToken, forceRefresh } from "../auth/refresh.js";
import { debug } from "../util/debug.js";

const API_BASE = "https://api.spotify.com/v1";
const MAX_RETRIES = 3;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** If set, body is sent raw with this content type instead of JSON. */
  rawBody?: { contentType: string; data: BodyInit };
  /** If true, do not auto-refresh on 401 (used to break recursion). */
  skipRefresh?: boolean;
}

/**
 * Fetches a Spotify Web API endpoint with auth, pacing, and retries.
 *
 * - Acquires a pacer slot before every attempt (process-level rate limiting).
 * - On 401, refreshes the access token once and retries.
 * - On 429, sleeps for `Retry-After` seconds + jitter and retries.
 * - On 5xx, exponential backoff with jitter and retries.
 * - Up to MAX_RETRIES total attempts (initial + retries).
 *
 * The path may be a relative API path (e.g. "/me") or a full URL (used for
 * `next`/`previous` paginator URLs returned by Spotify).
 */
export async function spotifyRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, opts.query);
  const method = opts.method ?? "GET";

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await acquireSlot();
    const accessToken = await getAccessToken();
    debug(`${method} ${url} (attempt ${attempt + 1})`);

    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    };
    let body: BodyInit | undefined;
    if (opts.rawBody) {
      headers["content-type"] = opts.rawBody.contentType;
      body = opts.rawBody.data;
    } else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body });
    } catch (err) {
      lastErr = err;
      const wait = backoffMs(attempt);
      debug(`network error: ${(err as Error).message}; retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }

    // 401: refresh once, retry once.
    if (res.status === 401 && !opts.skipRefresh) {
      debug(`401 — refreshing token and retrying`);
      try {
        await forceRefresh();
      } catch (err) {
        throw err;
      }
      // Retry immediately, but mark skipRefresh so we don't loop forever.
      return spotifyRequest<T>(path, { ...opts, skipRefresh: true });
    }

    // 429: honor Retry-After.
    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const wait = retryAfter + Math.floor(Math.random() * 100);
      debug(`429 — sleeping ${wait}ms (retry-after ${retryAfter}ms)`);
      lastErr = await toApiError(res);
      await sleep(wait);
      continue;
    }

    // 5xx: backoff and retry.
    if (res.status >= 500) {
      const wait = backoffMs(attempt);
      debug(`${res.status} — backing off ${wait}ms`);
      lastErr = await toApiError(res);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      throw await toApiError(res);
    }

    if (res.status === 204) {
      return undefined as T;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return (await res.json()) as T;
    }
    return undefined as T;
  }

  throw lastErr ?? new Error("request failed after retries");
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const base = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!query) return base;
  const url = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function toApiError(res: Response): Promise<SpotifyApiError> {
  let details: unknown;
  let message = `spotify api error ${res.status}`;
  try {
    const data = (await res.json()) as { error?: { message?: string; status?: number } };
    if (data?.error?.message) message = data.error.message;
    details = data;
  } catch {
    try {
      const text = await res.text();
      if (text) details = text;
    } catch {
      // ignore
    }
  }
  return new SpotifyApiError(res.status, message, details);
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 1000;
  const seconds = Number.parseFloat(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  return 1000;
}

function backoffMs(attempt: number): number {
  // 500ms, 1s, 2s + small jitter
  return 500 * 2 ** attempt + Math.floor(Math.random() * 100);
}
