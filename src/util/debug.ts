// Debug logging gated on either --debug (set via setDebugEnabled) or
// SPOTIFY_CLI_DEBUG=1 in the environment.

let enabled = process.env["SPOTIFY_CLI_DEBUG"] === "1";

export function setDebugEnabled(value: boolean): void {
  enabled = value || process.env["SPOTIFY_CLI_DEBUG"] === "1";
}

export function isDebugEnabled(): boolean {
  return enabled;
}

export function debug(msg: string): void {
  if (!enabled) return;
  process.stderr.write(`[debug] ${msg}\n`);
}
