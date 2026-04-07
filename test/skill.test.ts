import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_PATH = join(import.meta.dirname, "..", "skill", "SKILL.md");
const CONFIG_PATH = join(import.meta.dirname, "..", "skill", "config.yaml");

const skill = readFileSync(SKILL_PATH, "utf8");
const config = readFileSync(CONFIG_PATH, "utf8");

test("SKILL.md has YAML frontmatter delimited by ---", () => {
  assert.match(skill, /^---\n[\s\S]+?\n---\n/);
});

test("SKILL.md frontmatter declares the required fields", () => {
  const fm = skill.match(/^---\n([\s\S]+?)\n---/)![1]!;
  for (const key of ["name:", "description:", "version:", "platforms:", "tags:"]) {
    assert.ok(fm.includes(key), `frontmatter missing ${key}`);
  }
});

test("SKILL.md prompts for SPOTIFY_CLIENT_ID", () => {
  const fm = skill.match(/^---\n([\s\S]+?)\n---/)![1]!;
  assert.ok(fm.includes("SPOTIFY_CLIENT_ID"));
  assert.ok(fm.includes("required_environment_variables"));
});

test("SKILL.md contains the critical 'never call in parallel' pitfall", () => {
  // This is the load-bearing instruction that prevents 429 cascades.
  assert.ok(/NEVER call spotify-cli in parallel/i.test(skill));
  assert.ok(/Critical pitfall/i.test(skill) || /pitfalls/i.test(skill.toLowerCase()));
});

test("SKILL.md includes the standard Hermes skill sections", () => {
  for (const section of ["When to use", "Quick reference", "Procedure", "Pitfalls", "Verification"]) {
    assert.ok(
      new RegExp(`##\\s+${section}`, "i").test(skill),
      `missing section: ${section}`,
    );
  }
});

test("SKILL.md documents the search --limit ceiling change", () => {
  // Spotify Feb 2026 lowered the max from 50 to 10; the agent must know this.
  assert.ok(/--limit\s*max is 10/i.test(skill) || /max.*10/i.test(skill));
});

test("SKILL.md uses /playlists/{id}/items, not the deprecated /tracks path", () => {
  // The body shouldn't reference the deprecated /tracks variant in command examples.
  assert.equal(/playlists\/[^/]+\/tracks/.test(skill), false);
});

test("config.yaml declares min_interval_ms", () => {
  assert.match(config, /min_interval_ms\s*:\s*\d+/);
});
