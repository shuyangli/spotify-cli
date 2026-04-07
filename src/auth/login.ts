import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce.js";
import { writeToken, type StoredToken } from "./store.js";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// Scopes for playlist building + Spotify Connect playback control.
const SCOPES = [
  "user-read-private",
  "user-read-email",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "ugc-image-upload",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

interface LoginOptions {
  clientId: string;
  openBrowser?: boolean;
  /**
   * Full registered redirect URI, e.g. "http://127.0.0.1:8989/callback".
   * If omitted, the loopback server binds to an ephemeral port and the
   * caller's Spotify app must allow that. Most apps register a fixed port,
   * so this should usually be set.
   */
  redirectUri?: string;
}

export async function login(opts: LoginOptions): Promise<StoredToken> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();

  const { code, redirectUri } = await runLoopback(
    opts.clientId,
    challenge,
    state,
    opts.openBrowser ?? true,
    opts.redirectUri,
  );
  const token = await exchangeCode({ code, verifier, clientId: opts.clientId, redirectUri });
  await writeToken(token);
  return token;
}

interface LoopbackResult {
  code: string;
  redirectUri: string;
}

function runLoopback(
  clientId: string,
  challenge: string,
  state: string,
  openBrowser: boolean,
  fixedRedirectUri: string | undefined,
): Promise<LoopbackResult> {
  // Parse the requested redirect URI (if any) so we know which port and path
  // to bind. Default: ephemeral port + /callback path.
  let bindHost = "127.0.0.1";
  let bindPort = 0;
  let callbackPath = "/callback";
  if (fixedRedirectUri) {
    const u = new URL(fixedRedirectUri);
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      throw new Error(
        `redirect URI host must be 127.0.0.1 or localhost (got ${u.hostname})`,
      );
    }
    bindHost = u.hostname;
    bindPort = Number.parseInt(u.port || "80", 10);
    callbackPath = u.pathname || "/callback";
  }

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url || !req.url.startsWith(callbackPath)) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const url = new URL(req.url, `http://127.0.0.1`);
      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        respondHtml(res, 400, `<h1>Spotify auth failed</h1><p>${escapeHtml(error)}</p>`);
        server.close();
        reject(new Error(`spotify returned error: ${error}`));
        return;
      }
      if (returnedState !== state) {
        respondHtml(res, 400, `<h1>State mismatch</h1>`);
        server.close();
        reject(new Error("PKCE state mismatch"));
        return;
      }
      if (!code) {
        respondHtml(res, 400, `<h1>Missing code</h1>`);
        server.close();
        reject(new Error("missing authorization code"));
        return;
      }

      respondHtml(
        res,
        200,
        `<h1>spotify-cli authorized</h1><p>You can close this window and return to your terminal.</p>`,
      );
      server.close();
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const finalRedirectUri =
        fixedRedirectUri ?? `http://${bindHost}:${port}${callbackPath}`;
      resolve({ code, redirectUri: finalRedirectUri });
    });

    server.on("error", reject);
    server.listen(bindPort, bindHost, () => {
      const addr = server.address();
      if (typeof addr !== "object" || !addr) {
        server.close();
        reject(new Error("failed to bind loopback server"));
        return;
      }
      const redirectUri =
        fixedRedirectUri ?? `http://${bindHost}:${addr.port}${callbackPath}`;
      const authUrl = new URL(AUTH_URL);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", SCOPES);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("code_challenge", challenge);

      // Surface URL on stderr so JSON stdout stays clean.
      process.stderr.write(`Open this URL to authorize:\n${authUrl.toString()}\n`);
      if (openBrowser) tryOpen(authUrl.toString());
    });
  });
}

interface ExchangeArgs {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}

async function exchangeCode(args: ExchangeArgs): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
    client_id: args.clientId,
  };
}

function tryOpen(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // browser open is best-effort; user can copy URL from stderr
  }
}

function respondHtml(res: ServerResponse, code: number, html: string): void {
  res.statusCode = code;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><meta charset="utf-8">${html}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
