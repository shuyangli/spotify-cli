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
      const data = await spotifyRequest<Record<string, unknown>>("/search", {
        query: { q: query, type: opts.type, limit: opts.limit, offset: opts.offset },
      });
      printJson(data);
    });
}
