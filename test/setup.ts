// Imported via `--import` in the test script. Sets sandbox env vars BEFORE
// any test file is loaded so that tests can use static imports.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env["SPOTIFY_CLI_TEST_HOME"]) {
  const tmp = mkdtempSync(join(tmpdir(), "spotify-cli-test-"));
  process.env["SPOTIFY_CLI_TEST_HOME"] = tmp;
  process.env["HOME"] = tmp;
}
process.env["SPOTIFY_CLI_MIN_INTERVAL_MS"] = "0";
