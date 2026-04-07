import { test } from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";
import { writeToken } from "../src/auth/store.ts";
import { _resetPacerForTests } from "../src/http/pacer.ts";
import { registerSearchCommand } from "../src/commands/search.ts";

interface MockResponse {
  status: number;
  body?: unknown;
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
    const headers = new Headers({ "content-type": "application/json" });
    return new Response(r.body !== undefined ? JSON.stringify(r.body) : "{}", {
      status: r.status,
      headers,
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function freshProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSearchCommand(program);
  return program;
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

test.beforeEach(async () => {
  _resetPacerForTests();
  await writeToken({
    access_token: "access",
    refresh_token: "refresh",
    expires_at: Date.now() + 3600_000,
    scope: "user-read-private",
    token_type: "Bearer",
    client_id: "test-client",
  });
});

test("search default limit is 5 (Feb 2026 default)", async () => {
  const { calls, restore } = installFetchMock([
    { status: 200, body: { tracks: { items: [], total: 0, next: null } } },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "search", "jazz", "--type", "track"]);
  } finally {
    restore();
  }
  out.restore();
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/search");
  assert.equal(url.searchParams.get("q"), "jazz");
  assert.equal(url.searchParams.get("type"), "track");
  assert.equal(url.searchParams.get("limit"), "5");
});

test("search projects tracks to flat {uri,name,artists,album,duration_ms} list", async () => {
  const { restore } = installFetchMock([
    {
      status: 200,
      body: {
        tracks: {
          total: 1,
          next: null,
          items: [
            {
              uri: "spotify:track:aaa",
              name: "Blue in Green",
              duration_ms: 337733,
              explicit: false,
              artists: [{ name: "Miles Davis" }, { name: "Bill Evans" }],
              album: { name: "Kind of Blue", uri: "spotify:album:bbb" },
            },
          ],
        },
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "search", "jazz", "--type", "track"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.equal(parsed.total, 1);
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.items[0], {
    uri: "spotify:track:aaa",
    name: "Blue in Green",
    artists: ["Miles Davis", "Bill Evans"],
    album: "Kind of Blue",
    duration_ms: 337733,
    explicit: false,
  });
  // Critical: no album.images, no external_urls, no href — projection only.
  assert.equal(parsed.items[0].album.images, undefined);
});

test("search projects albums with artist names", async () => {
  const { restore } = installFetchMock([
    {
      status: 200,
      body: {
        albums: {
          total: 1,
          next: null,
          items: [
            {
              uri: "spotify:album:1",
              name: "Kind of Blue",
              release_date: "1959-08-17",
              total_tracks: 5,
              artists: [{ name: "Miles Davis" }],
            },
          ],
        },
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "search", "x", "--type", "album"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.deepEqual(parsed.items[0], {
    uri: "spotify:album:1",
    name: "Kind of Blue",
    artists: ["Miles Davis"],
    release_date: "1959-08-17",
    total_tracks: 5,
  });
});

test("search projects artists with genres/followers/popularity", async () => {
  const { restore } = installFetchMock([
    {
      status: 200,
      body: {
        artists: {
          total: 1,
          next: null,
          items: [
            {
              uri: "spotify:artist:1",
              name: "Bill Evans",
              genres: ["jazz", "cool jazz"],
              followers: { total: 1234567 },
              popularity: 65,
            },
          ],
        },
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "search", "x", "--type", "artist"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.deepEqual(parsed.items[0], {
    uri: "spotify:artist:1",
    name: "Bill Evans",
    genres: ["jazz", "cool jazz"],
    followers: 1234567,
    popularity: 65,
  });
});

test("search projects playlists with owner display name", async () => {
  const { restore } = installFetchMock([
    {
      status: 200,
      body: {
        playlists: {
          total: 1,
          next: null,
          items: [
            {
              uri: "spotify:playlist:1",
              name: "Late Night Jazz",
              description: "moody",
              owner: { display_name: "alice" },
            },
          ],
        },
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "search", "x", "--type", "playlist"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.deepEqual(parsed.items[0], {
    uri: "spotify:playlist:1",
    name: "Late Night Jazz",
    description: "moody",
    owner: "alice",
  });
});

test("search filters out null entries (Spotify sometimes returns nulls)", async () => {
  const { restore } = installFetchMock([
    {
      status: 200,
      body: {
        tracks: {
          total: 2,
          next: null,
          items: [
            null,
            {
              uri: "spotify:track:aaa",
              name: "Blue in Green",
              duration_ms: 100,
              explicit: false,
              artists: [{ name: "Miles" }],
              album: { name: "Kind of Blue", uri: "spotify:album:b" },
            },
          ],
        },
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "search", "x", "--type", "track"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].name, "Blue in Green");
});

test("search clamps --limit above 10 down to 10 (Feb 2026 max)", async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { tracks: { items: [] } } }]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "search", "jazz", "--type", "track", "--limit", "50",
    ]);
  } finally {
    restore();
  }
  out.restore();
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("limit"), "10");
});

test("search rejects invalid type", async () => {
  const { calls, restore } = installFetchMock([]);
  try {
    await assert.rejects(
      freshProgram().parseAsync([
        "node", "spotify-cli", "search", "jazz", "--type", "song",
      ]),
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
});

test("search accepts all valid types", async () => {
  for (const t of ["track", "album", "artist", "playlist", "episode", "show"]) {
    const { calls, restore } = installFetchMock([{ status: 200, body: {} }]);
    const out = captureStdout();
    try {
      await freshProgram().parseAsync([
        "node", "spotify-cli", "search", "x", "--type", t,
      ]);
    } finally {
      restore();
    }
    out.restore();
    assert.equal(new URL(calls[0]!.url).searchParams.get("type"), t);
  }
});

test("search passes offset through to API", async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: {} }]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "search", "x", "--type", "track", "--offset", "20",
    ]);
  } finally {
    restore();
  }
  out.restore();
  assert.equal(new URL(calls[0]!.url).searchParams.get("offset"), "20");
});
