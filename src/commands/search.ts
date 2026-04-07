import { Command, InvalidArgumentError } from "commander";
import { spotifyRequest } from "../http/client.js";
import { printJson } from "../util/output.js";

const VALID_TYPES = new Set(["track", "album", "artist", "playlist", "episode", "show"]);

// Per Feb 2026 changes the max limit dropped from 50 to 10 (default 5).
const SEARCH_LIMIT_MAX = 10;
const SEARCH_LIMIT_DEFAULT = 5;

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Search the Spotify catalog (limit clamped to 10 per Feb 2026 API)")
    .argument("<query>", "search query")
    .requiredOption(
      "--type <type>",
      "track | album | artist | playlist | episode | show",
      (raw: string) => {
        if (!VALID_TYPES.has(raw)) {
          throw new InvalidArgumentError(`type must be one of: ${[...VALID_TYPES].join(", ")}`);
        }
        return raw;
      },
    )
    .option(
      "--limit <n>",
      `max results (1-${SEARCH_LIMIT_MAX})`,
      (raw: string) => {
        const n = Number.parseInt(raw, 10);
        if (Number.isNaN(n) || n < 1) {
          throw new InvalidArgumentError("limit must be a positive integer");
        }
        // Clamp instead of error so an agent that asks for 50 still gets results.
        return Math.min(n, SEARCH_LIMIT_MAX);
      },
      SEARCH_LIMIT_DEFAULT,
    )
    .option("--offset <n>", "pagination offset", (raw: string) => {
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n) || n < 0) throw new InvalidArgumentError("offset must be ≥ 0");
      return n;
    }, 0)
    .action(async (query: string, opts: { type: string; limit: number; offset: number }) => {
      const data = await spotifyRequest<RawSearchResponse>("/search", {
        query: { q: query, type: opts.type, limit: opts.limit, offset: opts.offset },
      });
      printJson(projectSearch(data, opts.type));
    });
}

// ----- response shape projection -----
//
// The raw /search response is enormous: every track carries full album, image,
// and external_urls trees. Agents only need URI + name + artist names + a few
// disambiguators. We project to a flat list per type so the agent can pull
// `uri` directly from `items[i].uri` without spelunking.

interface RawArtist { uri: string; name: string }
interface RawImage { url: string; width: number; height: number }
interface RawAlbum {
  uri: string;
  name: string;
  release_date?: string;
  total_tracks?: number;
  images?: RawImage[];
  artists?: RawArtist[];
}
interface RawTrack {
  uri: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  artists: RawArtist[];
  album: RawAlbum;
}
interface RawArtistFull extends RawArtist {
  genres?: string[];
  followers?: { total: number };
  popularity?: number;
}
interface RawShow {
  uri: string;
  name: string;
  publisher: string;
  description?: string;
  total_episodes?: number;
}
interface RawEpisode {
  uri: string;
  name: string;
  duration_ms: number;
  release_date?: string;
  description?: string;
}
interface RawPlaylistRef {
  uri: string;
  name: string;
  description?: string;
  owner: { display_name: string | null };
}

interface PaginatedResults<T> {
  items: T[];
  total: number;
  next: string | null;
}

interface RawSearchResponse {
  tracks?: PaginatedResults<RawTrack | null>;
  albums?: PaginatedResults<RawAlbum | null>;
  artists?: PaginatedResults<RawArtistFull | null>;
  playlists?: PaginatedResults<RawPlaylistRef | null>;
  episodes?: PaginatedResults<RawEpisode | null>;
  shows?: PaginatedResults<RawShow | null>;
}

function projectSearch(data: RawSearchResponse, type: string): unknown {
  switch (type) {
    case "track": {
      const r = data.tracks;
      return paginated(r, (t) => t && {
        uri: t.uri,
        name: t.name,
        artists: t.artists.map((a) => a.name),
        album: t.album.name,
        duration_ms: t.duration_ms,
        explicit: t.explicit,
      });
    }
    case "album": {
      const r = data.albums;
      return paginated(r, (a) => a && {
        uri: a.uri,
        name: a.name,
        artists: a.artists?.map((ar) => ar.name) ?? [],
        release_date: a.release_date,
        total_tracks: a.total_tracks,
      });
    }
    case "artist": {
      const r = data.artists;
      return paginated(r, (a) => a && {
        uri: a.uri,
        name: a.name,
        genres: a.genres ?? [],
        followers: a.followers?.total,
        popularity: a.popularity,
      });
    }
    case "playlist": {
      const r = data.playlists;
      return paginated(r, (p) => p && {
        uri: p.uri,
        name: p.name,
        description: p.description ?? null,
        owner: p.owner?.display_name ?? null,
      });
    }
    case "episode": {
      const r = data.episodes;
      return paginated(r, (e) => e && {
        uri: e.uri,
        name: e.name,
        duration_ms: e.duration_ms,
        release_date: e.release_date,
      });
    }
    case "show": {
      const r = data.shows;
      return paginated(r, (s) => s && {
        uri: s.uri,
        name: s.name,
        publisher: s.publisher,
        total_episodes: s.total_episodes,
      });
    }
    default:
      return data;
  }
}

function paginated<T, U>(
  page: PaginatedResults<T> | undefined,
  project: (item: T) => U,
): { total: number; next: string | null; items: U[] } {
  if (!page) return { total: 0, next: null, items: [] };
  return {
    total: page.total,
    next: page.next,
    items: page.items.filter((i) => i != null).map(project),
  };
}
