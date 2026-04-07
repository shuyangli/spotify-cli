import { test } from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";
import { writeToken } from "../src/auth/store.ts";
import { _resetPacerForTests } from "../src/http/pacer.ts";
import { registerPlaybackCommands } from "../src/commands/playback.ts";

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
  registerPlaybackCommands(program);
  return program;
}

test.beforeEach(async () => {
  _resetPacerForTests();
  await writeToken({
    access_token: "access",
    refresh_token: "refresh",
    expires_at: Date.now() + 3600_000,
    scope: "user-modify-playback-state",
    token_type: "Bearer",
    client_id: "test-client",
  });
});

test("devices list returns the device array", async () => {
  const { calls, restore } = installFetchMock([
    {
      status: 200,
      body: {
        devices: [
          {
            id: "dev1",
            name: "Living Room",
            type: "Speaker",
            is_active: true,
            is_private_session: false,
            is_restricted: false,
            volume_percent: 50,
            supports_volume: true,
          },
        ],
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "devices", "list"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/me/player/devices");
  assert.equal(parsed.devices[0].name, "Living Room");
});

test("playback status with 204 returns is_playing:false envelope", async () => {
  const { restore } = installFetchMock([{ status: 204 }]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "status"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.deepEqual(parsed, { is_playing: false, device: null, item: null });
});

test("playback status projects active session to flat shape", async () => {
  const { restore } = installFetchMock([
    {
      status: 200,
      body: {
        is_playing: true,
        shuffle_state: true,
        repeat_state: "context",
        progress_ms: 12345,
        timestamp: 1775526806969,
        device: {
          id: "dev1",
          name: "Living Room",
          type: "Speaker",
          is_active: true,
          volume_percent: 60,
          supports_volume: true,
        },
        context: {
          uri: "spotify:playlist:p1",
          type: "playlist",
          href: "https://api.spotify.com/v1/playlists/p1",
          external_urls: { spotify: "https://open.spotify.com/playlist/p1" },
        },
        item: {
          uri: "spotify:track:t1",
          name: "Blue in Green",
          type: "track",
          duration_ms: 337733,
          is_playable: true,
          artists: [{ name: "Miles Davis", uri: "spotify:artist:a1" }],
          album: {
            name: "Kind of Blue",
            uri: "spotify:album:al1",
            images: [{ url: "https://...", width: 640, height: 640 }],
          },
        },
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "status"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.deepEqual(parsed, {
    is_playing: true,
    shuffle: true,
    repeat: "context",
    progress_ms: 12345,
    device: {
      id: "dev1",
      name: "Living Room",
      type: "Speaker",
      is_active: true,
      volume_percent: 60,
    },
    context: { uri: "spotify:playlist:p1", type: "playlist" },
    item: {
      uri: "spotify:track:t1",
      name: "Blue in Green",
      type: "track",
      duration_ms: 337733,
      artists: ["Miles Davis"],
      album: "Kind of Blue",
    },
  });
});

test("playback status projects podcast episodes to use show name as album", async () => {
  const { restore } = installFetchMock([
    {
      status: 200,
      body: {
        is_playing: true,
        shuffle_state: false,
        repeat_state: "off",
        progress_ms: 1000,
        device: { id: "d", name: "Phone", type: "Smartphone", is_active: true, volume_percent: 50 },
        context: null,
        item: {
          uri: "spotify:episode:e1",
          name: "Episode 42",
          type: "episode",
          duration_ms: 3600000,
          show: { name: "The Podcast", uri: "spotify:show:s1" },
        },
      },
    },
  ]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "status"]);
  } finally {
    restore();
  }
  const parsed = JSON.parse(out.restore());
  assert.equal(parsed.item.album, "The Podcast");
  assert.equal(parsed.item.type, "episode");
  assert.deepEqual(parsed.item.artists, []);
});

test("playback transfer PUTs /me/player with device_ids and play flag", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "playback", "transfer", "dev1", "--play",
    ]);
  } finally {
    restore();
  }
  out.restore();
  assert.equal(calls[0]!.init.method, "PUT");
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/me/player");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.deepEqual(body, { device_ids: ["dev1"], play: true });
});

test("playback play with --context-uri sends body and device_id query", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }]);
  const out = captureStdout();
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "playback", "play",
      "--device", "dev1",
      "--context-uri", "spotify:playlist:abc",
    ]);
  } finally {
    restore();
  }
  out.restore();
  assert.equal(calls[0]!.init.method, "PUT");
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/me/player/play");
  assert.equal(url.searchParams.get("device_id"), "dev1");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.equal(body.context_uri, "spotify:playlist:abc");
});

test("playback play with --uris parses comma-separated list", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }]);
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "playback", "play",
      "--uris", "spotify:track:aaa,spotify:track:bbb",
    ]);
  } finally {
    restore();
  }
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.deepEqual(body.uris, ["spotify:track:aaa", "spotify:track:bbb"]);
});

test("playback play rejects --context-uri + --uris together", async () => {
  const { calls, restore } = installFetchMock([]);
  try {
    await assert.rejects(
      freshProgram().parseAsync([
        "node", "spotify-cli", "playback", "play",
        "--context-uri", "spotify:playlist:abc",
        "--uris", "spotify:track:aaa",
      ]),
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
});

test("playback play rejects invalid URI without an API call", async () => {
  const { calls, restore } = installFetchMock([]);
  try {
    await assert.rejects(
      freshProgram().parseAsync([
        "node", "spotify-cli", "playback", "play",
        "--uris", "not-a-uri",
      ]),
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
});

test("playback pause PUTs /me/player/pause", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }]);
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "pause"]);
  } finally {
    restore();
  }
  assert.equal(calls[0]!.init.method, "PUT");
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/me/player/pause");
});

test("playback next POSTs /me/player/next", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }]);
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "next"]);
  } finally {
    restore();
  }
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/me/player/next");
});

test("playback previous POSTs /me/player/previous", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }]);
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "previous"]);
  } finally {
    restore();
  }
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/me/player/previous");
});

test("playback seek puts position_ms in query", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }]);
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "seek", "30000"]);
  } finally {
    restore();
  }
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/me/player/seek");
  assert.equal(url.searchParams.get("position_ms"), "30000");
});

test("playback volume puts volume_percent in query", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }]);
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "volume", "30"]);
  } finally {
    restore();
  }
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/me/player/volume");
  assert.equal(url.searchParams.get("volume_percent"), "30");
});

test("playback volume rejects out-of-range values", async () => {
  const { calls, restore } = installFetchMock([]);
  try {
    await assert.rejects(
      freshProgram().parseAsync(["node", "spotify-cli", "playback", "volume", "150"]),
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
});

test("playback shuffle on/off maps to true/false", async () => {
  const { calls, restore } = installFetchMock([
    { status: 204 },
    { status: 204 },
  ]);
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "shuffle", "on"]);
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "shuffle", "off"]);
  } finally {
    restore();
  }
  assert.equal(new URL(calls[0]!.url).searchParams.get("state"), "true");
  assert.equal(new URL(calls[1]!.url).searchParams.get("state"), "false");
});

test("playback repeat accepts off/track/context", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }, { status: 204 }, { status: 204 }]);
  try {
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "repeat", "off"]);
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "repeat", "track"]);
    await freshProgram().parseAsync(["node", "spotify-cli", "playback", "repeat", "context"]);
  } finally {
    restore();
  }
  assert.equal(new URL(calls[0]!.url).searchParams.get("state"), "off");
  assert.equal(new URL(calls[1]!.url).searchParams.get("state"), "track");
  assert.equal(new URL(calls[2]!.url).searchParams.get("state"), "context");
});

test("playback repeat rejects invalid mode", async () => {
  const { calls, restore } = installFetchMock([]);
  try {
    await assert.rejects(
      freshProgram().parseAsync(["node", "spotify-cli", "playback", "repeat", "loop"]),
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
});

test("queue add validates URI and POSTs with uri query param", async () => {
  const { calls, restore } = installFetchMock([{ status: 204 }]);
  try {
    await freshProgram().parseAsync([
      "node", "spotify-cli", "queue", "add", "spotify:track:aaa",
    ]);
  } finally {
    restore();
  }
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/me/player/queue");
  assert.equal(url.searchParams.get("uri"), "spotify:track:aaa");
  assert.equal(calls[0]!.init.method, "POST");
});

test("queue add rejects bare ID", async () => {
  const { calls, restore } = installFetchMock([]);
  try {
    await assert.rejects(
      freshProgram().parseAsync(["node", "spotify-cli", "queue", "add", "aaa"]),
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
});
