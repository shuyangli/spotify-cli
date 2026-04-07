import { test } from "node:test";
import assert from "node:assert/strict";
import { writeToken } from "../src/auth/store.ts";
import { _resetPacerForTests } from "../src/http/pacer.ts";
import { spotifyRequest } from "../src/http/client.ts";
import { SpotifyApiError } from "../src/http/errors.ts";

interface MockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function installFetchMock(responses: MockResponse[]): {
  calls: Array<{ url: string; init: RequestInit }>;
  restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    const r = responses[i++];
    if (!r) throw new Error(`unexpected fetch call #${i} to ${url}`);
    const headers = new Headers(r.headers ?? {});
    if (r.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, {
      status: r.status,
      headers,
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function seedToken(): Promise<void> {
  await writeToken({
    access_token: "initial-access",
    refresh_token: "refresh-xyz",
    expires_at: Date.now() + 3600_000,
    scope: "playlist-read-private",
    token_type: "Bearer",
    client_id: "test-client",
  });
}

test.beforeEach(async () => {
  _resetPacerForTests();
  await seedToken();
});

test("happy path: GET returns parsed JSON", async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { id: "abc" } }]);
  try {
    const result = await spotifyRequest<{ id: string }>("/me");
    assert.deepEqual(result, { id: "abc" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://api.spotify.com/v1/me");
    assert.equal((calls[0]!.init.headers as Record<string, string>)["authorization"], "Bearer initial-access");
  } finally {
    restore();
  }
});

test("query params are appended to URL", async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { items: [] } }]);
  try {
    await spotifyRequest("/search", { query: { q: "jazz", type: "track", limit: 5 } });
    const url = new URL(calls[0]!.url);
    assert.equal(url.searchParams.get("q"), "jazz");
    assert.equal(url.searchParams.get("type"), "track");
    assert.equal(url.searchParams.get("limit"), "5");
  } finally {
    restore();
  }
});

test("POST with JSON body sends content-type and serialized body", async () => {
  const { calls, restore } = installFetchMock([{ status: 201, body: { id: "p1" } }]);
  try {
    await spotifyRequest("/me/playlists", { method: "POST", body: { name: "test" } });
    const init = calls[0]!.init;
    assert.equal(init.method, "POST");
    assert.equal((init.headers as Record<string, string>)["content-type"], "application/json");
    assert.equal(init.body, JSON.stringify({ name: "test" }));
  } finally {
    restore();
  }
});

test("204 No Content returns undefined", async () => {
  const { restore } = installFetchMock([{ status: 204 }]);
  try {
    const result = await spotifyRequest("/me/player/pause", { method: "PUT" });
    assert.equal(result, undefined);
  } finally {
    restore();
  }
});

test("429 honors Retry-After and retries", async () => {
  const { calls, restore } = installFetchMock([
    { status: 429, headers: { "retry-after": "0" }, body: { error: { message: "rate limited" } } },
    { status: 200, body: { ok: true } },
  ]);
  try {
    const t0 = Date.now();
    const result = await spotifyRequest<{ ok: boolean }>("/me");
    const elapsed = Date.now() - t0;
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
    assert.ok(elapsed < 500, `expected fast retry on Retry-After: 0, got ${elapsed}ms`);
  } finally {
    restore();
  }
});

test("5xx triggers exponential backoff and retries", async () => {
  const { calls, restore } = installFetchMock([
    { status: 503, body: { error: { message: "down" } } },
    { status: 200, body: { ok: true } },
  ]);
  try {
    const result = await spotifyRequest<{ ok: boolean }>("/me");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});

test("retries are bounded; final 5xx surfaces SpotifyApiError", async () => {
  const { calls, restore } = installFetchMock([
    { status: 500, body: { error: { message: "boom" } } },
    { status: 500, body: { error: { message: "boom" } } },
    { status: 500, body: { error: { message: "boom" } } },
  ]);
  try {
    await assert.rejects(spotifyRequest("/me"), (err) => {
      assert.ok(err instanceof SpotifyApiError);
      assert.equal((err as InstanceType<typeof SpotifyApiError>).status, 500);
      return true;
    });
    assert.equal(calls.length, 3);
  } finally {
    restore();
  }
});

test("4xx (other than 401/429) throws immediately without retry", async () => {
  const { calls, restore } = installFetchMock([
    { status: 404, body: { error: { message: "not found" } } },
  ]);
  try {
    await assert.rejects(spotifyRequest("/playlists/nope"), (err) => {
      assert.ok(err instanceof SpotifyApiError);
      assert.equal((err as InstanceType<typeof SpotifyApiError>).status, 404);
      assert.equal((err as InstanceType<typeof SpotifyApiError>).code, "not_found");
      return true;
    });
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test("401 triggers a refresh and retries the request once", async () => {
  const { calls, restore } = installFetchMock([
    { status: 401, body: { error: { message: "expired" } } },
    {
      status: 200,
      body: {
        access_token: "refreshed-access",
        refresh_token: "refresh-xyz",
        expires_in: 3600,
        scope: "playlist-read-private",
        token_type: "Bearer",
      },
    },
    { status: 200, body: { ok: true } },
  ]);
  try {
    const result = await spotifyRequest<{ ok: boolean }>("/me");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 3);
    assert.equal(calls[1]!.url, "https://accounts.spotify.com/api/token");
    assert.equal(
      (calls[2]!.init.headers as Record<string, string>)["authorization"],
      "Bearer refreshed-access",
    );
  } finally {
    restore();
  }
});

test("repeated 401 after refresh does not loop infinitely", async () => {
  const { calls, restore } = installFetchMock([
    { status: 401, body: { error: { message: "expired" } } },
    {
      status: 200,
      body: {
        access_token: "another-access",
        refresh_token: "refresh-xyz",
        expires_in: 3600,
        scope: "playlist-read-private",
        token_type: "Bearer",
      },
    },
    { status: 401, body: { error: { message: "still bad" } } },
  ]);
  try {
    await assert.rejects(spotifyRequest("/me"), (err) => {
      assert.ok(err instanceof SpotifyApiError);
      assert.equal((err as InstanceType<typeof SpotifyApiError>).status, 401);
      return true;
    });
    assert.equal(calls.length, 3);
  } finally {
    restore();
  }
});
