import { test } from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { writeToken, readToken, deleteToken, tokenPath, tokenFileMode } from "../src/auth/store.ts";

const sample = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  expires_at: Date.now() + 3600_000,
  scope: "playlist-read-private",
  token_type: "Bearer",
  client_id: "test-client",
};

test("token round-trips through write/read", async () => {
  await writeToken(sample);
  const read = await readToken();
  assert.deepEqual(read, sample);
  assert.ok(tokenPath().includes("spotify-cli"));
});

test("token file is created with mode 0600", async () => {
  await writeToken(sample);
  const mode = await tokenFileMode();
  assert.equal(mode, 0o600);
  const s = await stat(tokenPath());
  assert.equal(s.mode & 0o777, 0o600);
});

test("readToken returns null when no token file exists", async () => {
  await deleteToken();
  const read = await readToken();
  assert.equal(read, null);
});

test("deleteToken returns true if removed, false if absent", async () => {
  await writeToken(sample);
  assert.equal(await deleteToken(), true);
  assert.equal(await deleteToken(), false);
});
