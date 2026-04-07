import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, writeFile, chmod, unlink, stat } from "node:fs/promises";

export interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
  token_type: string;
  client_id: string;
}

// Computed lazily so tests can set HOME before any function call.
function configDir(): string {
  return join(homedir(), ".config", "spotify-cli");
}

export function tokenPath(): string {
  return join(configDir(), "token.json");
}

export async function readToken(): Promise<StoredToken | null> {
  try {
    const raw = await readFile(tokenPath(), "utf8");
    return JSON.parse(raw) as StoredToken;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeToken(token: StoredToken): Promise<void> {
  const path = tokenPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(token, null, 2), { mode: 0o600 });
  // writeFile mode is only honored if file is created; ensure 0600 either way
  await chmod(path, 0o600);
}

export async function deleteToken(): Promise<boolean> {
  try {
    await unlink(tokenPath());
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function tokenFileMode(): Promise<number | null> {
  try {
    const s = await stat(tokenPath());
    return s.mode & 0o777;
  } catch {
    return null;
  }
}
