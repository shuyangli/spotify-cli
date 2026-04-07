import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { writeToken } from "../src/auth/store.ts";
import { _resetPacerForTests } from "../src/http/pacer.ts";
import { registerPlaylistCommands, assertSpotifyUri } from "../src/commands/playlist.ts";

interface MockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface MockState {
  calls: Array<{ url: string; init: RequestInit }>;
  restore: () => void;
}

function installFetchMock(responses: MockResponse[]): MockState {
  const original = globalThis.fetch;
  const calls: MockState["calls"] = [];
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

function captureStdout(): { restore: () => string } {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return {
    restore: () => {
      process.stdout.write = original;
      return chunks.join("");
    },
  };
}

function freshProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerPlaylistCommands(program);
  return program;
}

async function seedToken(): Promise<void> {
  await writeToken({
    access_token: "access",
    refresh_token: "refresh",
    expires_at: Date.now() + 3600_000,
    scope: "playlist-modify-private",
    token_type: "Bearer",
    client_id: "test-client",
  });
}

test.beforeEach(async () => {
  _resetPacerForTests();
  await seedToken();
});

test("URI validator accepts valid Spotify URIs", () => {
  assertSpotifyUri("spotify:track:4iV5W9uYEdYUVa79Axb7Rh");
  assertSpotifyUri("spotify:album:0sNOF9WDwhWunNAHPD3Baj");
  assertSpotifyUri("spotify:episode:abc123");
});

test("URI validator rejects bare IDs and malformed URIs", () => {
  assert.throws(() => assertSpotifyUri("4iV5W9uYEdYUVa79Axb7Rh"));
  assert.throws(() => assertSpotifyUri("spotify:track:"));
  assert.throws(() => assertSpotifyUri("spotify:foo:abc"));
  assert.throws(() => assertSpotifyUri("https://open.spotify.com/track/abc"));
});

test("playlist list calls /me/playlists with limit + offset and summarizes items", async () => {
  const { calls, restore } = installFetchMock([
    {
      status: 200,
      body: {
        items: [
          {
            id: "p1",
            name: "Jazz",
            owner: { id: "alice", display_name: "Alice" },
            public: true,
            collaborative: false,
            items: { total: 12 },
          },
        ],
        total: 1,
        next: null,
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playlist", "list", "--limit", "10"]);
  } finally {
    restore();
  }
  const stdout = out.restore();
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/me/playlists");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(url.searchParams.get("offset"), "0");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.items[0].name, "Jazz");
  assert.equal(parsed.items[0].track_count, 12);
});

test("playlist create POSTs directly to /me/playlists (Feb 2026 path)", async () => {
  const { calls, restore } = installFetchMock([
    {
      status: 201,
      body: {
        id: "newp",
        name: "Made by claude",
        owner: { id: "alice", display_name: "Alice" },
        public: false,
        collaborative: false,
        items: { total: 0 },
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "playlist", "create",
      "--name", "Made by claude",
      "--description", "test playlist",
    ]);
  } finally {
    restore();
  }
  const stdout = out.restore();
  // Single call — no /me preflight needed.
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/me/playlists");
  assert.equal(calls[0]!.init.method, "POST");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.equal(body.name, "Made by claude");
  assert.equal(body.description, "test playlist");
  assert.equal(body.public, false);
  assert.equal(JSON.parse(stdout).id, "newp");
});

test("playlist create does NOT hit the deprecated /users/{id}/playlists path", async () => {
  const { calls, restore } = installFetchMock([
    {
      status: 201,
      body: {
        id: "p",
        name: "n",
        owner: { id: "u", display_name: null },
        public: false,
        collaborative: false,
        items: { total: 0 },
      },
    },
  ]);
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "playlist", "create", "--name", "n",
    ]);
  } finally {
    restore();
  }
  for (const call of calls) {
    assert.equal(/\/v1\/users\/[^/]+\/playlists/.test(call.url), false);
  }
});

test("playlist add validates URIs and POSTs to /playlists/{id}/items (Feb 2026 path)", async () => {
  const { calls, restore } = installFetchMock([{ status: 201, body: { snapshot_id: "snap1" } }]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "playlist", "add", "p1",
      "spotify:track:aaa",
      "spotify:track:bbb",
    ]);
  } finally {
    restore();
  }
  const stdout = out.restore();
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/playlists/p1/items");
  assert.equal(calls[0]!.init.method, "POST");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.deepEqual(body.uris, ["spotify:track:aaa", "spotify:track:bbb"]);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.added, 2);
  assert.equal(parsed.snapshot_id, "snap1");
});

test("playlist add rejects bare IDs without making any API call", async () => {
  const { calls, restore } = installFetchMock([]);
  try {
    await assert.rejects(
      freshProgram().parseAsync([
        "node", "spotify-cli", "playlist", "add", "p1", "not-a-uri",
      ]),
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
});

test("playlist remove sends DELETE with tracks[].uri envelope", async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { snapshot_id: "snap2" } }]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "playlist", "remove", "p1", "spotify:track:aaa",
    ]);
  } finally {
    restore();
  }
  out.restore();
  assert.equal(calls[0]!.init.method, "DELETE");
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/playlists/p1/items");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.deepEqual(body, { tracks: [{ uri: "spotify:track:aaa" }] });
});

test("playlist reorder PUTs range_start/insert_before/range_length", async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { snapshot_id: "snap3" } }]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "playlist", "reorder", "p1",
      "--range-start", "0",
      "--insert-before", "3",
      "--range-length", "2",
    ]);
  } finally {
    restore();
  }
  out.restore();
  assert.equal(calls[0]!.init.method, "PUT");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.deepEqual(body, { range_start: 0, insert_before: 3, range_length: 2 });
});

test("playlist items uses /items (not deprecated /tracks) and projects fields", async () => {
  const { calls, restore } = installFetchMock([
    {
      status: 200,
      body: {
        total: 1,
        next: null,
        items: [
          {
            added_at: "2026-04-01T00:00:00Z",
            item: {
              uri: "spotify:track:aaa",
              name: "Blue in Green",
              type: "track",
              artists: [{ name: "Miles Davis" }],
            },
          },
        ],
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playlist", "items", "p1"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/playlists/p1/items");
  assert.equal(parsed.items[0].name, "Blue in Green");
  assert.deepEqual(parsed.items[0].artists, ["Miles Davis"]);
});

test("playlist details requires at least one field to update", async () => {
  const { calls, restore } = installFetchMock([]);
  try {
    await assert.rejects(
      freshProgram().parseAsync(["node", "spotify-cli", "playlist", "details", "p1"]),
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
});

test("playlist details rejects --public + --private together", async () => {
  const { calls, restore } = installFetchMock([]);
  try {
    await assert.rejects(
      freshProgram().parseAsync([
        "node", "spotify-cli", "playlist", "details", "p1", "--public", "--private",
      ]),
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
});

test("playlist cover uploads base64 JPEG with image/jpeg content type", async () => {
  const imgPath = join(tmpdir(), `cover-${Date.now()}-${Math.random()}.jpg`);
  writeFileSync(imgPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  const { calls, restore } = installFetchMock([{ status: 202 }]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "playlist", "cover", "p1", "--image", imgPath,
    ]);
  } finally {
    restore();
  }
  out.restore();
  assert.equal(calls[0]!.init.method, "PUT");
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>)["content-type"],
    "image/jpeg",
  );
  assert.equal(calls[0]!.init.body, Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64"));
});
