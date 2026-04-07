#!/usr/bin/env node
import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerPlaylistCommands } from "./commands/playlist.js";
import { registerPlaybackCommands } from "./commands/playback.js";
import { registerSearchCommand } from "./commands/search.js";
import { printError } from "./util/output.js";
import { setDebugEnabled } from "./util/debug.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("spotify-cli")
    .description("Build Spotify playlists and control Spotify Connect playback")
    .version("0.0.1")
    .option("--debug", "Enable verbose stderr logging")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      if (opts["debug"]) setDebugEnabled(true);
    });

  registerAuthCommands(program);
  registerPlaylistCommands(program);
  registerPlaybackCommands(program);
  registerSearchCommand(program);

  // commander throws on action errors; route them through our error envelope.
  program.exitOverride();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // commander's own help/version exits also throw — only treat real errors as failures.
    const code = (err as { code?: string }).code;
    if (code === "commander.help" || code === "commander.helpDisplayed" || code === "commander.version") {
      return;
    }
    printError(err);
    process.exit(1);
  }
}

main().catch((err) => {
  printError(err);
  process.exit(1);
});
