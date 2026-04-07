import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Override HOME so the store writes into a tmp dir for tests.
const tmpHome = mkdtempSync(join(tmpdir(), "spotify-cli-test-"));
process.env["HOME"] = tmpHome;

const { writeToken, readToken, deleteToken, tokenPath, tokenFileMode } = await import(
  "../src/auth/store.ts"
);

test.after(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

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
  assert.ok(tokenPath().startsWith(tmpHome));
});

test("token file is created with mode 0600", async () => {
  await writeToken(sample);
  const mode = await tokenFileMode();
  assert.equal(mode, 0o600);
  // also stat directly as belt-and-suspenders
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
