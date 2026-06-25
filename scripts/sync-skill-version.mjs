#!/usr/bin/env node

/**
 * Sync library_version in SKILL.md files with package.json version.
 *
 * Run automatically after `changeset version` via the release workflow.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Schema } from "effect";

const root = resolve(import.meta.dirname, "..");
const PackageJson = Schema.Struct({
  version: Schema.String,
});
const PackageJsonFromString = Schema.decodeUnknownSync(Schema.fromJsonString(PackageJson));
const version = PackageJsonFromString(readFileSync(join(root, "package.json"), "utf8")).version;

function findSkillFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findSkillFiles(full));
    } else if (entry === "SKILL.md") {
      results.push(full);
    }
  }
  return results;
}

const skillsDir = join(root, "skills");
const files = findSkillFiles(skillsDir);
let updated = 0;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const replaced = content.replace(/^(library_version:\s*").+(")/m, `$1${version}$2`);
  if (replaced !== content) {
    writeFileSync(file, replaced);
    updated++;
    console.log(`✓ ${file.replace(root + "/", "").replace(root + "\\", "")}`);
  }
}

if (updated > 0) {
  console.log(`\nSynced library_version to ${version} in ${updated} file(s)`);
} else {
  console.log(`All skill files already at ${version}`);
}
