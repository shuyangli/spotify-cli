import { webcrypto } from "node:crypto";

// PKCE per RFC 7636. Verifier: 43–128 chars from [A-Z a-z 0-9 - . _ ~].
const VERIFIER_BYTES = 64; // 64 random bytes -> 86-char base64url string

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  webcrypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await webcrypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

export function generateState(): string {
  const bytes = new Uint8Array(16);
  webcrypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
