# spotify-cli

A small CLI for building Spotify playlists and controlling Spotify Connect
playback. Designed to be driven by a [Hermes
agent](https://hermes-agent.nousresearch.com/), but works fine standalone.

Every command emits a single JSON object/array on stdout. Errors land on
stderr in a `{"error": {...}}` envelope with a non-zero exit code.

## Install

```sh
npm install -g spotify-cli
```

Or from source:

```sh
git clone <this-repo>
cd spotify-cli && npm install && npm run build && npm link
```

Requires Node ≥ 20.

## Authenticate

1. Register an app at <https://developer.spotify.com/dashboard>.
2. In the app settings, add `http://127.0.0.1/callback` as a redirect URI.
   (The CLI uses an ephemeral loopback port — Spotify accepts any port for
   `127.0.0.1` redirects, but the URI must be registered.)
3. Export your client ID and run `auth login`:

```sh
export SPOTIFY_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxx
spotify-cli auth login
```

The token is cached at `~/.config/spotify-cli/token.json` (mode `0600`) and
auto-refreshed before expiry.

## Examples

```sh
# Search and build
spotify-cli search "miles davis" --type artist
spotify-cli playlist create --name "Tonight"
spotify-cli playlist add 7vxxx... spotify:track:aaa spotify:track:bbb

# Connect playback
spotify-cli devices list
spotify-cli playback transfer <deviceId> --play
spotify-cli playback play --context-uri spotify:playlist:7vxxx...
spotify-cli playback volume 30
```

See `spotify-cli --help` for the full surface.

## Rate limiting

Spotify enforces a per-app rolling 30-second quota. The CLI:

- Serializes outbound requests within a process and inserts a minimum
  inter-request gap (default 250 ms; override with
  `SPOTIFY_CLI_MIN_INTERVAL_MS`).
- Honors `Retry-After` on 429 responses with jittered retries.
- Backs off exponentially on 5xx (max 3 attempts).
- Refreshes the access token automatically on 401 (once per request).

**If you're driving this from an agent, never issue `spotify-cli` calls in
parallel** — the CLI's pacer only protects against intra-process bursts; the
quota is shared across all processes using the same app.

## Hermes skill

The `skill/` directory packages this CLI as a Hermes agent skill. See
[`skill/SKILL.md`](skill/SKILL.md). Publish with:

```sh
hermes skills publish skill --to github --repo <owner>/<repo>
```

## Development

```sh
npm install
npm test          # 57 unit/integration tests, no network
npm run build
npx tsx src/index.ts --help
```

## License

MIT
