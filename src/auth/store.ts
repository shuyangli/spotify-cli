import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, readdir, writeFile, chmod, unlink, stat } from "node:fs/promises";

export interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
  token_type: string;
  client_id: string;
}

export const DEFAULT_PROFILE = "default";

// Profile names are baked into a filesystem path, so restrict to a safe charset.
const PROFILE_NAME_RE = /^[A-Za-z0-9._-]+$/;

let currentProfile: string = DEFAULT_PROFILE;

export function setProfile(name: string): void {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new Error(
      `invalid profile name "${name}" — must match ${PROFILE_NAME_RE}`,
    );
  }
  currentProfile = name;
}

export function getProfile(): string {
  return currentProfile;
}

// Computed lazily so tests can set HOME before any function call.
function configDir(): string {
  return join(homedir(), ".config", "spotify-cli");
}

function profileDir(profile: string = currentProfile): string {
  return join(configDir(), "profiles", profile);
}

export function tokenPath(profile: string = currentProfile): string {
  return join(profileDir(profile), "token.json");
}

// Pre-profiles, the token lived directly under configDir. Kept readable for the
// default profile so existing installs keep working without a manual migration.
function legacyTokenPath(): string {
  return join(configDir(), "token.json");
}

export async function readToken(): Promise<StoredToken | null> {
  const primary = tokenPath();
  const fromPrimary = await readJsonIfExists<StoredToken>(primary);
  if (fromPrimary) return fromPrimary;
  if (currentProfile === DEFAULT_PROFILE) {
    return await readJsonIfExists<StoredToken>(legacyTokenPath());
  }
  return null;
}

export async function writeToken(token: StoredToken): Promise<void> {
  const path = tokenPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(token, null, 2), { mode: 0o600 });
  // writeFile mode is only honored if file is created; ensure 0600 either way
  await chmod(path, 0o600);
}

export async function deleteToken(): Promise<boolean> {
  let removed = false;
  if (await tryUnlink(tokenPath())) removed = true;
  // Fully evict the legacy file too on default-profile logout so a stale token
  // can't shadow the new path on the next read.
  if (currentProfile === DEFAULT_PROFILE) {
    if (await tryUnlink(legacyTokenPath())) removed = true;
  }
  return removed;
}

export async function tokenFileMode(): Promise<number | null> {
  const path = await activeTokenPath();
  if (!path) return null;
  try {
    const s = await stat(path);
    return s.mode & 0o777;
  } catch {
    return null;
  }
}

/**
 * Resolves the on-disk path of the token actually in use right now. Returns
 * null if no token exists for the current profile. Prefer this over
 * `tokenPath()` for user-facing output, since legacy installs may still be
 * reading from the pre-profiles location.
 */
export async function activeTokenPath(): Promise<string | null> {
  const primary = tokenPath();
  if (await pathExists(primary)) return primary;
  if (currentProfile === DEFAULT_PROFILE) {
    const legacy = legacyTokenPath();
    if (await pathExists(legacy)) return legacy;
  }
  return null;
}

/**
 * List profile names that have a token on disk. Used by `auth profiles`.
 * The legacy default-profile token is reported as "default" so it shows up.
 */
export async function listProfiles(): Promise<string[]> {
  const found = new Set<string>();
  try {
    const entries = await readdir(join(configDir(), "profiles"), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (await pathExists(join(configDir(), "profiles", e.name, "token.json"))) {
        found.add(e.name);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (await pathExists(legacyTokenPath())) found.add(DEFAULT_PROFILE);
  return [...found].sort();
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function tryUnlink(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
