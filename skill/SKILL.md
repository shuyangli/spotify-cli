---
name: spotify
description: Build Spotify playlists and control playback on Spotify Connect devices via the spotify-cli command. Use whenever the user asks to create/edit playlists, search the catalog, list devices, or play/pause/skip music.
version: 0.1.0
author: shuyangli
license: MIT
platforms: [macos, linux]
tags: [music, spotify, playlists, playback, spotify-connect]
required_environment_variables:
  SPOTIFY_CLIENT_ID:
    prompt: "Your Spotify app client ID. Register an app at https://developer.spotify.com/dashboard, then add a redirect URI of http://127.0.0.1/callback in the app settings."
config:
  min_interval_ms: 250
---

# Spotify

Build playlists and control Spotify Connect playback through `spotify-cli`.
Every subcommand prints a single JSON object/array to stdout. Errors print a
`{"error": {...}}` envelope to stderr with a non-zero exit code.

## When to use

Use this skill whenever the user wants to:

- Create, modify, browse, or delete playlists
- Add/remove/reorder tracks within a playlist
- Search the Spotify catalog (tracks, albums, artists, playlists, etc.)
- See what devices are available on Spotify Connect
- Start, pause, skip, seek, or transfer playback to a device
- Adjust volume / shuffle / repeat / queue

## ⚠️ Critical pitfall: NEVER call spotify-cli in parallel

Spotify enforces a per-app rolling 30-second rate limit that is **shared
across every process and host using your client ID**. If you fan out
`spotify-cli` calls in parallel (e.g. via concurrent tool calls) you WILL hit
HTTP 429 and the request budget will be punished for the next ~30 seconds.

**Always wait for one `spotify-cli` invocation to return before starting the
next.** Even when adding many tracks to a playlist, do it as a single
`spotify-cli playlist add <id> <uri1> <uri2> ...` call (not one call per
track), and never run `spotify-cli` simultaneously with another
`spotify-cli`.

The CLI also enforces a 250 ms minimum gap between requests within a single
process, and honors `Retry-After` on 429 — but the parallel-call rule is on
you, the agent, because cross-process pacing is not possible.

## Quick reference

| Need to… | Command |
|---|---|
| Authenticate | `spotify-cli auth login --client-id $SPOTIFY_CLIENT_ID` |
| Check auth | `spotify-cli auth status` |
| Sign out | `spotify-cli auth logout` |
| Search the catalog | `spotify-cli search "<query>" --type track\|album\|artist\|playlist [--limit N]` |
| List user playlists | `spotify-cli playlist list [--limit N] [--offset N]` |
| Create a playlist | `spotify-cli playlist create --name "<name>" [--description "<text>"] [--public]` |
| Get playlist details | `spotify-cli playlist get <playlistId>` |
| Update playlist details | `spotify-cli playlist details <playlistId> [--name ...] [--description ...] [--public\|--private]` |
| List items in a playlist | `spotify-cli playlist items <playlistId> [--limit N] [--offset N]` |
| Add items | `spotify-cli playlist add <playlistId> <uri> [<uri>...] [--position N]` |
| Remove items | `spotify-cli playlist remove <playlistId> <uri> [<uri>...]` |
| Reorder items | `spotify-cli playlist reorder <playlistId> --range-start N --insert-before N [--range-length N]` |
| Upload cover image | `spotify-cli playlist cover <playlistId> --image <path-to-jpeg>` |
| List Connect devices | `spotify-cli devices list` |
| Show playback state | `spotify-cli playback status` |
| Transfer to a device | `spotify-cli playback transfer <deviceId> [--play]` |
| Start/resume playback | `spotify-cli playback play [--device <id>] [--context-uri <uri> \| --uris uri,uri,...] [--position-ms N]` |
| Pause | `spotify-cli playback pause [--device <id>]` |
| Next / previous | `spotify-cli playback next \| previous [--device <id>]` |
| Seek | `spotify-cli playback seek <ms> [--device <id>]` |
| Volume (0-100) | `spotify-cli playback volume <percent> [--device <id>]` |
| Shuffle | `spotify-cli playback shuffle on\|off [--device <id>]` |
| Repeat | `spotify-cli playback repeat off\|track\|context [--device <id>]` |
| Queue add | `spotify-cli queue add <uri> [--device <id>]` |
| Queue list | `spotify-cli queue list` |

## Procedure

1. **Confirm auth.** Run `spotify-cli auth status`. If `authenticated` is
   false (or the command fails), tell the user to run
   `spotify-cli auth login --client-id $SPOTIFY_CLIENT_ID` themselves — it
   opens a browser and you can't complete the flow on their behalf.
2. **Find what you want to play.** Use `spotify-cli search "<query>"
   --type track --limit 10`. Pull `uri` fields from the results.
3. **Build the playlist** (if needed). `spotify-cli playlist create --name
   "..."` returns the new playlist `id`. Then call
   `spotify-cli playlist add <id> <uri1> <uri2> ...` **once**, passing all
   URIs at the same time.
4. **Pick a device.** `spotify-cli devices list` returns the available
   Connect targets. If `playback status` is empty, you must transfer
   playback to a device before issuing further commands.
5. **Play it.** `spotify-cli playback transfer <deviceId> --play` followed
   by `spotify-cli playback play --device <deviceId> --context-uri
   spotify:playlist:<id>`.

Remember: every `spotify-cli` invocation is a SEPARATE tool call. **Each tool
call must complete before the next one is started.**

## Pitfalls

- **No parallel calls.** See the warning above.
- **Use full Spotify URIs**, not bare IDs. URIs look like
  `spotify:track:4iV5W9uYEdYUVa79Axb7Rh`.
- **Search `--limit` max is 10** (Feb 2026 API change). Asking for more
  silently clamps.
- **Playback commands need an active device.** If `playback status` returns
  `{"is_playing": false}` with no device, run `devices list` and
  `playback transfer <id> --play` first.
- **Cover images must be JPEG and under 256 KB.**
- **Token storage:** OAuth tokens live at `~/.config/spotify-cli/token.json`
  with mode 0600. Never read or echo them.

## Verification

After building a playlist and starting playback, verify with two follow-up
calls (made serially):

1. `spotify-cli playlist items <id>` — confirm the expected number of items.
2. `spotify-cli playback status` — confirm `is_playing: true` and the
   currently playing track URI matches one of the items you added.

## Installation

```sh
npm install -g spotify-cli   # or `npm install -g github:shuyangli/spotify-cli`
```

Then set `SPOTIFY_CLIENT_ID` (registered at
https://developer.spotify.com/dashboard with redirect URI
`http://127.0.0.1/callback`) and run `spotify-cli auth login`.
