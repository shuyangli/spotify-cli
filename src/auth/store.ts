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

const CONFIG_DIR = join(homedir(), ".config", "spotify-cli");
const TOKEN_PATH = join(CONFIG_DIR, "token.json");

export function tokenPath(): string {
  return TOKEN_PATH;
}

export async function readToken(): Promise<StoredToken | null> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf8");
    return JSON.parse(raw) as StoredToken;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeToken(token: StoredToken): Promise<void> {
  await mkdir(dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
  await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
  // writeFile mode is only honored if file is created; ensure 0600 either way
  await chmod(TOKEN_PATH, 0o600);
}

export async function deleteToken(): Promise<boolean> {
  try {
    await unlink(TOKEN_PATH);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function tokenFileMode(): Promise<number | null> {
  try {
    const s = await stat(TOKEN_PATH);
    return s.mode & 0o777;
  } catch {
    return null;
  }
}
