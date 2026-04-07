import { readToken, writeToken, type StoredToken } from "./store.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const EXPIRY_SKEW_MS = 60_000; // refresh 60s before expiry

export async function getAccessToken(): Promise<string> {
  const token = await readToken();
  if (!token) {
    throw new AuthError("not authenticated — run `spotify-cli auth login`");
  }
  if (Date.now() < token.expires_at - EXPIRY_SKEW_MS) {
    return token.access_token;
  }
  const refreshed = await refresh(token);
  return refreshed.access_token;
}

export async function forceRefresh(): Promise<string> {
  const token = await readToken();
  if (!token) {
    throw new AuthError("not authenticated — run `spotify-cli auth login`");
  }
  const refreshed = await refresh(token);
  return refreshed.access_token;
}

async function refresh(token: StoredToken): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
    client_id: token.client_id,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AuthError(`token refresh failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  const updated: StoredToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? token.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
    client_id: token.client_id,
  };
  await writeToken(updated);
  return updated;
}

export class AuthError extends Error {
  override name = "AuthError";
}
