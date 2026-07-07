/**
 * Dev launcher: runs `agentlint review` against examples/demo without
 * shell-specific `cd` plumbing. Used by .claude/launch.json for browser
 * previews of the review UI.
 */

import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../examples/demo", import.meta.url)));
process.argv = [process.argv[0], "agentlint", "review", "--no-open", "--port", "4973"];

await import("../packages/agentlint/dist/bin.mjs");
