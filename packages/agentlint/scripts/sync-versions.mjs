#!/usr/bin/env node

/**
 * Sync every copy of the package version with package.json:
 *
 * - `library_version` in skills/**\/SKILL.md
 * - the `version` input default in <repo>/action/action.yml, when present
 *
 * Run automatically after `changeset version` via scripts/version.sh.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Schema } from "effect";

const root = resolve(import.meta.dirname, "..");
const repoRoot = resolve(root, "..", "..");
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

/** Replace the first `default: "<semver>"` that follows the `version:` input key. */
function syncActionVersion(content) {
  const input = /^\s+version:\s*$/m.exec(content);
  if (!input) return content;
  const head = content.slice(0, input.index);
  const tail = content.slice(input.index);
  return head + tail.replace(/^(\s+default:\s*")\d+\.\d+\.\d+[^"]*(")/m, `$1${version}$2`);
}

const targets = [
  ...findSkillFiles(join(root, "skills")).map((file) => ({
    file,
    sync: (content) => content.replace(/^(library_version:\s*").+(")/m, `$1${version}$2`),
  })),
  { file: join(repoRoot, "action", "action.yml"), sync: syncActionVersion },
];

let updated = 0;
for (const { file, sync } of targets) {
  if (!existsSync(file)) continue;
  const content = readFileSync(file, "utf8");
  const replaced = sync(content);
  if (replaced !== content) {
    writeFileSync(file, replaced);
    updated++;
    console.log(`✓ ${relative(repoRoot, file)}`);
  }
}

if (updated > 0) {
  console.log(`\nSynced version ${version} in ${updated} file(s)`);
} else {
  console.log(`All files already at ${version}`);
}
