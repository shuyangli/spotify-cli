import { Command, InvalidArgumentError } from "commander";
import { readFile } from "node:fs/promises";
import { spotifyRequest } from "../http/client.js";
import { printJson } from "../util/output.js";

interface PlaylistRef {
  id: string;
  name: string;
  owner: { id: string; display_name: string | null };
  public: boolean | null;
  collaborative: boolean;
  // Per the Feb 2026 API change, the playlist summary's track-count field is
  // `items: { total }`, not `tracks: { total }`. Old code that hits the
  // legacy field will get `undefined.total` and crash.
  items: { total: number };
}

interface PaginatedPlaylists {
  items: PlaylistRef[];
  total: number;
  next: string | null;
}

export function registerPlaylistCommands(program: Command): void {
  const pl = program.command("playlist").description("Build and manage playlists");

  pl.command("list")
    .description("List the current user's playlists")
    .option("--limit <n>", "max items (1-50)", parseIntInRange(1, 50), 20)
    .option("--offset <n>", "pagination offset", parseIntInRange(0, 100_000), 0)
    .action(async (opts: { limit: number; offset: number }) => {
      const data = await spotifyRequest<PaginatedPlaylists>("/me/playlists", {
        query: { limit: opts.limit, offset: opts.offset },
      });
      printJson({
        total: data.total,
        next: data.next,
        items: data.items.map(summarizePlaylist),
      });
    });

  pl.command("create")
    .description("Create a new playlist for the current user")
    .requiredOption("--name <name>", "playlist name")
    .option("--description <text>", "playlist description")
    .option("--public", "make the playlist public", false)
    .option("--collaborative", "make the playlist collaborative (requires private)", false)
    .action(async (opts: { name: string; description?: string; public: boolean; collaborative: boolean }) => {
      // Per Feb 2026: create lives at POST /me/playlists. The legacy
      // POST /users/{user_id}/playlists path now returns 403, paired with
      // the deprecation of GET /users/{id}. /me/playlists also avoids the
      // extra /me round-trip the old code path used.
      const body: Record<string, unknown> = {
        name: opts.name,
        public: opts.public,
        collaborative: opts.collaborative,
      };
      if (opts.description !== undefined) body["description"] = opts.description;
      const created = await spotifyRequest<PlaylistRef>("/me/playlists", {
        method: "POST",
        body,
      });
      printJson(summarizePlaylist(created));
    });

  pl.command("get")
    .description("Get full details of a playlist")
    .argument("<playlistId>")
    .action(async (playlistId: string) => {
      const data = await spotifyRequest<PlaylistRef & { description: string | null; uri: string }>(
        `/playlists/${encodeURIComponent(playlistId)}`,
      );
      printJson({
        ...summarizePlaylist(data),
        description: data.description,
        uri: data.uri,
      });
    });

  pl.command("details")
    .description("Update playlist name, description, and visibility")
    .argument("<playlistId>")
    .option("--name <name>")
    .option("--description <text>")
    .option("--public", "make the playlist public")
    .option("--private", "make the playlist private")
    .action(
      async (
        playlistId: string,
        opts: { name?: string; description?: string; public?: boolean; private?: boolean },
      ) => {
        if (opts.public && opts.private) {
          throw new Error("--public and --private are mutually exclusive");
        }
        const body: Record<string, unknown> = {};
        if (opts.name !== undefined) body["name"] = opts.name;
        if (opts.description !== undefined) body["description"] = opts.description;
        if (opts.public !== undefined || opts.private !== undefined) {
          body["public"] = opts.public === true;
        }
        if (Object.keys(body).length === 0) {
          throw new Error("nothing to update; pass --name, --description, --public, or --private");
        }
        await spotifyRequest(`/playlists/${encodeURIComponent(playlistId)}`, {
          method: "PUT",
          body,
        });
        printJson({ ok: true, updated: Object.keys(body) });
      },
    );

  pl.command("items")
    .description("List the items in a playlist")
    .argument("<playlistId>")
    .option("--limit <n>", "max items (1-100)", parseIntInRange(1, 100), 50)
    .option("--offset <n>", "pagination offset", parseIntInRange(0, 100_000), 0)
    .action(async (playlistId: string, opts: { limit: number; offset: number }) => {
      // Per Feb 2026: payload is `item: {...}` (not the old `track: {...}`).
      // The endpoint also uses /items, not the deprecated /tracks.
      // There's still a sibling boolean `track: true|false` indicating the
      // item type — don't conflate it with the payload object.
      const data = await spotifyRequest<{
        items: Array<{
          added_at: string;
          item: {
            uri: string;
            name: string;
            type: string;
            artists?: Array<{ name: string }>;
          } | null;
        }>;
        total: number;
        next: string | null;
      }>(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        query: { limit: opts.limit, offset: opts.offset },
      });
      printJson({
        total: data.total,
        next: data.next,
        items: data.items.map((it) => ({
          added_at: it.added_at,
          uri: it.item?.uri ?? null,
          name: it.item?.name ?? null,
          type: it.item?.type ?? null,
          artists: it.item?.artists?.map((a) => a.name) ?? [],
        })),
      });
    });

  pl.command("add")
    .description("Add one or more items (full Spotify URIs) to a playlist")
    .argument("<playlistId>")
    .argument("<uris...>", "Spotify URIs (e.g. spotify:track:...)")
    .option("--position <n>", "0-based position to insert", parseIntInRange(0, 100_000))
    .action(async (playlistId: string, uris: string[], opts: { position?: number }) => {
      uris.forEach(assertSpotifyUri);
      const body: Record<string, unknown> = { uris };
      if (opts.position !== undefined) body["position"] = opts.position;
      const result = await spotifyRequest<{ snapshot_id: string }>(
        `/playlists/${encodeURIComponent(playlistId)}/items`,
        { method: "POST", body },
      );
      printJson({ ok: true, added: uris.length, snapshot_id: result.snapshot_id });
    });

  pl.command("remove")
    .description("Remove items (full Spotify URIs) from a playlist")
    .argument("<playlistId>")
    .argument("<uris...>", "Spotify URIs (e.g. spotify:track:...)")
    .action(async (playlistId: string, uris: string[]) => {
      uris.forEach(assertSpotifyUri);
      const result = await spotifyRequest<{ snapshot_id: string }>(
        `/playlists/${encodeURIComponent(playlistId)}/items`,
        {
          method: "DELETE",
          body: { tracks: uris.map((uri) => ({ uri })) },
        },
      );
      printJson({ ok: true, removed: uris.length, snapshot_id: result.snapshot_id });
    });

  pl.command("reorder")
    .description("Reorder a contiguous range of items within a playlist")
    .argument("<playlistId>")
    .requiredOption("--range-start <n>", "0-based index of the first item to move", parseIntInRange(0, 100_000))
    .requiredOption("--insert-before <n>", "0-based index to insert before", parseIntInRange(0, 100_000))
    .option("--range-length <n>", "number of items in the range", parseIntInRange(1, 100), 1)
    .action(
      async (
        playlistId: string,
        opts: { rangeStart: number; insertBefore: number; rangeLength: number },
      ) => {
        const result = await spotifyRequest<{ snapshot_id: string }>(
          `/playlists/${encodeURIComponent(playlistId)}/items`,
          {
            method: "PUT",
            body: {
              range_start: opts.rangeStart,
              insert_before: opts.insertBefore,
              range_length: opts.rangeLength,
            },
          },
        );
        printJson({ ok: true, snapshot_id: result.snapshot_id });
      },
    );

  pl.command("cover")
    .description("Upload a JPEG cover image for a playlist (must be < 256 KB)")
    .argument("<playlistId>")
    .requiredOption("--image <path>", "path to a JPEG file")
    .action(async (playlistId: string, opts: { image: string }) => {
      const buf = await readFile(opts.image);
      const base64 = buf.toString("base64");
      await spotifyRequest(`/playlists/${encodeURIComponent(playlistId)}/images`, {
        method: "PUT",
        rawBody: { contentType: "image/jpeg", data: base64 },
      });
      printJson({ ok: true, bytes: buf.byteLength });
    });
}

function summarizePlaylist(p: PlaylistRef): {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string | null;
  public: boolean | null;
  collaborative: boolean;
  track_count: number;
} {
  return {
    id: p.id,
    name: p.name,
    owner_id: p.owner.id,
    owner_name: p.owner.display_name,
    public: p.public,
    collaborative: p.collaborative,
    track_count: p.items.total,
  };
}

export function assertSpotifyUri(uri: string): void {
  if (!/^spotify:(track|episode|album|artist|playlist):[A-Za-z0-9]+$/.test(uri)) {
    throw new Error(
      `invalid Spotify URI: ${uri} (expected e.g. spotify:track:1234abcd)`,
    );
  }
}

function parseIntInRange(min: number, max: number): (raw: string) => number {
  return (raw) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < min || n > max) {
      throw new InvalidArgumentError(`expected integer in [${min}, ${max}]`);
    }
    return n;
  };
}
