import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { stat, mkdir, writeFile, rm } from "node:fs/promises";
import {
  writeToken,
  readToken,
  deleteToken,
  tokenPath,
  tokenFileMode,
  setProfile,
  getProfile,
  activeTokenPath,
  listProfiles,
  DEFAULT_PROFILE,
} from "../src/auth/store.ts";

const sample = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  expires_at: Date.now() + 3600_000,
  scope: "playlist-read-private",
  token_type: "Bearer",
  client_id: "test-client",
};

// Module-level profile state leaks between tests; reset before each.
test.beforeEach(async () => {
  setProfile(DEFAULT_PROFILE);
  await rm(join(homedir(), ".config", "spotify-cli"), { recursive: true, force: true });
});

test("token round-trips through write/read", async () => {
  await writeToken(sample);
  const read = await readToken();
  assert.deepEqual(read, sample);
  assert.ok(tokenPath().includes("spotify-cli"));
});

test("default profile writes under profiles/default", async () => {
  await writeToken(sample);
  assert.ok(tokenPath().includes(join("profiles", "default", "token.json")));
  const s = await stat(tokenPath());
  assert.equal(s.mode & 0o777, 0o600);
});

test("token file is created with mode 0600", async () => {
  await writeToken(sample);
  const mode = await tokenFileMode();
  assert.equal(mode, 0o600);
});

test("readToken returns null when no token file exists", async () => {
  const read = await readToken();
  assert.equal(read, null);
});

test("deleteToken returns true if removed, false if absent", async () => {
  await writeToken(sample);
  assert.equal(await deleteToken(), true);
  assert.equal(await deleteToken(), false);
});

test("different profiles get isolated token paths and contents", async () => {
  setProfile("shuyang");
  await writeToken({ ...sample, access_token: "shuyang-access" });
  setProfile("partner");
  await writeToken({ ...sample, access_token: "partner-access" });

  setProfile("shuyang");
  assert.equal(getProfile(), "shuyang");
  assert.ok(tokenPath().includes(join("profiles", "shuyang", "token.json")));
  assert.equal((await readToken())?.access_token, "shuyang-access");

  setProfile("partner");
  assert.ok(tokenPath().includes(join("profiles", "partner", "token.json")));
  assert.equal((await readToken())?.access_token, "partner-access");

  // Deleting one profile leaves the other intact.
  assert.equal(await deleteToken(), true);
  setProfile("shuyang");
  assert.equal((await readToken())?.access_token, "shuyang-access");
});

test("default profile falls back to legacy ~/.config/spotify-cli/token.json", async () => {
  // Seed a legacy token from the pre-profiles era.
  const legacy = join(homedir(), ".config", "spotify-cli", "token.json");
  await mkdir(join(homedir(), ".config", "spotify-cli"), { recursive: true });
  await writeFile(legacy, JSON.stringify({ ...sample, access_token: "legacy-access" }));

  // No new-path token exists yet — read should surface the legacy one.
  const read = await readToken();
  assert.equal(read?.access_token, "legacy-access");
  assert.equal(await activeTokenPath(), legacy);
});

test("default profile prefers new path over legacy when both exist", async () => {
  const legacy = join(homedir(), ".config", "spotify-cli", "token.json");
  await mkdir(join(homedir(), ".config", "spotify-cli"), { recursive: true });
  await writeFile(legacy, JSON.stringify({ ...sample, access_token: "legacy-access" }));
  await writeToken({ ...sample, access_token: "new-access" });

  const read = await readToken();
  assert.equal(read?.access_token, "new-access");
  assert.equal(await activeTokenPath(), tokenPath());
});

test("non-default profile does NOT read legacy token", async () => {
  const legacy = join(homedir(), ".config", "spotify-cli", "token.json");
  await mkdir(join(homedir(), ".config", "spotify-cli"), { recursive: true });
  await writeFile(legacy, JSON.stringify({ ...sample, access_token: "legacy-access" }));

  setProfile("partner");
  assert.equal(await readToken(), null);
});

test("default-profile logout removes both new and legacy paths", async () => {
  const legacy = join(homedir(), ".config", "spotify-cli", "token.json");
  await mkdir(join(homedir(), ".config", "spotify-cli"), { recursive: true });
  await writeFile(legacy, JSON.stringify({ ...sample, access_token: "legacy-access" }));
  await writeToken({ ...sample, access_token: "new-access" });

  assert.equal(await deleteToken(), true);
  assert.equal(await readToken(), null);
});

test("setProfile rejects invalid names", () => {
  assert.throws(() => setProfile("bad name"), /invalid profile name/);
  assert.throws(() => setProfile("../escape"), /invalid profile name/);
  assert.throws(() => setProfile(""), /invalid profile name/);
});

test("listProfiles enumerates profile directories with tokens", async () => {
  setProfile("shuyang");
  await writeToken(sample);
  setProfile("partner");
  await writeToken(sample);
  setProfile(DEFAULT_PROFILE);

  // Empty profile dir (no token) should be ignored.
  await mkdir(join(homedir(), ".config", "spotify-cli", "profiles", "empty"), { recursive: true });

  assert.deepEqual(await listProfiles(), ["partner", "shuyang"]);
});

test("listProfiles surfaces a legacy-only token as 'default'", async () => {
  const legacy = join(homedir(), ".config", "spotify-cli", "token.json");
  await mkdir(join(homedir(), ".config", "spotify-cli"), { recursive: true });
  await writeFile(legacy, JSON.stringify(sample));

  assert.deepEqual(await listProfiles(), ["default"]);
});
