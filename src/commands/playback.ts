import { Command, InvalidArgumentError } from "commander";
import { spotifyRequest } from "../http/client.js";
import { printJson } from "../util/output.js";
import { assertSpotifyUri } from "./playlist.js";

interface Device {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  volume_percent: number | null;
  supports_volume: boolean;
}

export function registerPlaybackCommands(program: Command): void {
  // ----- devices -----
  const devices = program.command("devices").description("List Spotify Connect devices");
  devices
    .command("list")
    .description("List available Spotify Connect devices")
    .action(async () => {
      const data = await spotifyRequest<{ devices: Device[] }>("/me/player/devices");
      printJson({ devices: data.devices });
    });

  // ----- playback -----
  const playback = program.command("playback").description("Control Spotify Connect playback");

  playback
    .command("status")
    .description("Show the current playback state")
    .action(async () => {
      const data = await spotifyRequest<unknown>("/me/player");
      // /me/player returns 204 (no content) when nothing is playing
      printJson(data ?? { is_playing: false });
    });

  playback
    .command("transfer")
    .description("Transfer playback to a Spotify Connect device")
    .argument("<deviceId>")
    .option("--play", "begin playback after transfer", false)
    .action(async (deviceId: string, opts: { play: boolean }) => {
      await spotifyRequest("/me/player", {
        method: "PUT",
        body: { device_ids: [deviceId], play: opts.play },
      });
      printJson({ ok: true, device_id: deviceId, play: opts.play });
    });

  playback
    .command("play")
    .description("Start or resume playback (optionally on a specific device)")
    .option("--device <id>", "target device id")
    .option("--context-uri <uri>", "Spotify URI of the playback context (album/playlist/artist)")
    .option(
      "--uris <uris>",
      "comma-separated Spotify track/episode URIs",
      (raw: string) => raw.split(",").map((s) => s.trim()).filter(Boolean),
    )
    .option("--position-ms <ms>", "start position in milliseconds", parseIntInRange(0, Number.MAX_SAFE_INTEGER))
    .action(
      async (opts: {
        device?: string;
        contextUri?: string;
        uris?: string[];
        positionMs?: number;
      }) => {
        if (opts.contextUri && opts.uris) {
          throw new Error("--context-uri and --uris are mutually exclusive");
        }
        if (opts.contextUri) assertSpotifyUri(opts.contextUri);
        if (opts.uris) opts.uris.forEach(assertSpotifyUri);
        const body: Record<string, unknown> = {};
        if (opts.contextUri) body["context_uri"] = opts.contextUri;
        if (opts.uris) body["uris"] = opts.uris;
        if (opts.positionMs !== undefined) body["position_ms"] = opts.positionMs;
        await spotifyRequest("/me/player/play", {
          method: "PUT",
          query: { device_id: opts.device },
          body: Object.keys(body).length > 0 ? body : undefined,
        });
        printJson({ ok: true });
      },
    );

  playback
    .command("pause")
    .description("Pause playback")
    .option("--device <id>")
    .action(async (opts: { device?: string }) => {
      await spotifyRequest("/me/player/pause", {
        method: "PUT",
        query: { device_id: opts.device },
      });
      printJson({ ok: true });
    });

  playback
    .command("next")
    .description("Skip to the next track")
    .option("--device <id>")
    .action(async (opts: { device?: string }) => {
      await spotifyRequest("/me/player/next", {
        method: "POST",
        query: { device_id: opts.device },
      });
      printJson({ ok: true });
    });

  playback
    .command("previous")
    .description("Skip to the previous track")
    .option("--device <id>")
    .action(async (opts: { device?: string }) => {
      await spotifyRequest("/me/player/previous", {
        method: "POST",
        query: { device_id: opts.device },
      });
      printJson({ ok: true });
    });

  playback
    .command("seek")
    .description("Seek to a position (milliseconds)")
    .argument("<positionMs>", "position in ms", parseIntInRange(0, Number.MAX_SAFE_INTEGER))
    .option("--device <id>")
    .action(async (positionMs: number, opts: { device?: string }) => {
      await spotifyRequest("/me/player/seek", {
        method: "PUT",
        query: { position_ms: positionMs, device_id: opts.device },
      });
      printJson({ ok: true, position_ms: positionMs });
    });

  playback
    .command("volume")
    .description("Set the playback volume (0-100)")
    .argument("<percent>", "volume percent 0-100", parseIntInRange(0, 100))
    .option("--device <id>")
    .action(async (percent: number, opts: { device?: string }) => {
      await spotifyRequest("/me/player/volume", {
        method: "PUT",
        query: { volume_percent: percent, device_id: opts.device },
      });
      printJson({ ok: true, volume_percent: percent });
    });

  playback
    .command("shuffle")
    .description("Toggle shuffle on or off")
    .argument("<state>", "on or off")
    .option("--device <id>")
    .action(async (state: string, opts: { device?: string }) => {
      if (state !== "on" && state !== "off") {
        throw new Error("state must be 'on' or 'off'");
      }
      await spotifyRequest("/me/player/shuffle", {
        method: "PUT",
        query: { state: state === "on" ? "true" : "false", device_id: opts.device },
      });
      printJson({ ok: true, shuffle: state });
    });

  playback
    .command("repeat")
    .description("Set repeat mode")
    .argument("<mode>", "off | track | context")
    .option("--device <id>")
    .action(async (mode: string, opts: { device?: string }) => {
      if (mode !== "off" && mode !== "track" && mode !== "context") {
        throw new Error("mode must be off, track, or context");
      }
      await spotifyRequest("/me/player/repeat", {
        method: "PUT",
        query: { state: mode, device_id: opts.device },
      });
      printJson({ ok: true, repeat: mode });
    });

  // ----- queue -----
  const queue = program.command("queue").description("Inspect and modify the playback queue");
  queue
    .command("add")
    .description("Add a track or episode to the queue")
    .argument("<uri>")
    .option("--device <id>")
    .action(async (uri: string, opts: { device?: string }) => {
      assertSpotifyUri(uri);
      await spotifyRequest("/me/player/queue", {
        method: "POST",
        query: { uri, device_id: opts.device },
      });
      printJson({ ok: true, queued: uri });
    });
  queue
    .command("list")
    .description("Show the current playback queue")
    .action(async () => {
      const data = await spotifyRequest<unknown>("/me/player/queue");
      printJson(data ?? { currently_playing: null, queue: [] });
    });
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
