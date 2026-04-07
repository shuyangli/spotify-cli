import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../src/auth/pkce.ts";

test("verifier is base64url, length within RFC 7636 bounds (43–128)", () => {
  const v = generateCodeVerifier();
  assert.match(v, /^[A-Za-z0-9_-]+$/);
  assert.ok(v.length >= 43 && v.length <= 128, `verifier length ${v.length} out of range`);
});

test("verifiers are unique across calls", () => {
  const a = generateCodeVerifier();
  const b = generateCodeVerifier();
  assert.notEqual(a, b);
});

test("challenge is sha256(verifier) base64url-encoded", async () => {
  const verifier = "x".repeat(64);
  const challenge = await generateCodeChallenge(verifier);
  const expected = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const expectedB64Url = Buffer.from(new Uint8Array(expected))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.equal(challenge, expectedB64Url);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(challenge.includes("="), false);
});

test("state is unique base64url with sufficient entropy", () => {
  const a = generateState();
  const b = generateState();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 16);
});
