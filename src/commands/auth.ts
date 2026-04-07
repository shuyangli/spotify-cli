import { Command } from "commander";
import { login } from "../auth/login.js";
import { readToken, deleteToken, tokenPath, tokenFileMode } from "../auth/store.js";
import { printJson } from "../util/output.js";

const SPOTIFY_ME = "https://api.spotify.com/v1/me";

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage Spotify OAuth credentials");

  auth
    .command("login")
    .description("Authorize spotify-cli via OAuth PKCE (loopback flow)")
    .option(
      "--client-id <id>",
      "Spotify app client ID (or set SPOTIFY_CLIENT_ID env var)",
    )
    .option(
      "--redirect-uri <uri>",
      "Registered redirect URI on the Spotify app, e.g. http://127.0.0.1:8989/callback (or set SPOTIFY_REDIRECT_URI). The CLI binds the host:port from this URI for the OAuth callback.",
    )
    .option("--no-open", "Do not attempt to open the browser automatically")
    .action(async (opts: { clientId?: string; redirectUri?: string; open: boolean }) => {
      const clientId = opts.clientId ?? process.env["SPOTIFY_CLIENT_ID"];
      if (!clientId) {
        throw new Error(
          "missing client id — pass --client-id or set SPOTIFY_CLIENT_ID. Register an app at https://developer.spotify.com/dashboard",
        );
      }
      const redirectUri = opts.redirectUri ?? process.env["SPOTIFY_REDIRECT_URI"];
      const token = await login({ clientId, openBrowser: opts.open, redirectUri });
      printJson({
        ok: true,
        scopes: token.scope.split(" ").filter(Boolean),
        expires_at: new Date(token.expires_at).toISOString(),
        token_path: tokenPath(),
      });
    });

  auth
    .command("status")
    .description("Show whether spotify-cli is authenticated")
    .action(async () => {
      const token = await readToken();
      if (!token) {
        printJson({ authenticated: false });
        return;
      }
      // Best-effort profile fetch using the cached token (no refresh here to keep status fast).
      let profile: { id: string; display_name: string | null } | null = null;
      try {
        const res = await fetch(SPOTIFY_ME, {
          headers: { authorization: `Bearer ${token.access_token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { id: string; display_name: string | null };
          profile = { id: data.id, display_name: data.display_name };
        }
      } catch {
        // ignore — status should not throw on transient network failures
      }
      printJson({
        authenticated: true,
        client_id: token.client_id,
        scopes: token.scope.split(" ").filter(Boolean),
        expires_at: new Date(token.expires_at).toISOString(),
        token_path: tokenPath(),
        token_file_mode: (await tokenFileMode())?.toString(8) ?? null,
        profile,
      });
    });

  auth
    .command("logout")
    .description("Delete the cached token file")
    .action(async () => {
      const removed = await deleteToken();
      printJson({ ok: true, removed });
    });
}
