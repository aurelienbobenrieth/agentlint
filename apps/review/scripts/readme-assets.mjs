#!/usr/bin/env node

/**
 * Regenerate the README images from the real CLI and review UI. Run `pnpm build` first.
 *
 * Pnpm --filter @agentlint/review readme:assets
 *
 * Copies `examples/demo` into a throwaway repository, so the committed demo state never changes, then writes framed
 * PNGs to `docs/assets/`: the gate output, and the review UI on three findings.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(app, "..", "..");
const packageRoot = join(repository, "packages", "agentlint");
const bin = join(packageRoot, "dist", "bin.mjs");
const assets = join(repository, "docs", "assets");
if (!existsSync(join(packageRoot, "dist", "ui", "index.html"))) {
  throw new Error("The review UI is not built. Run `pnpm build` first.");
}

const work = mkdtempSync(join(tmpdir(), "agentlint-readme-"));
const demo = join(work, "demo");
cpSync(join(repository, "examples", "demo"), demo, {
  recursive: true,
  filter: (source) => !/[\\/](node_modules|\.cache)$/u.test(source),
});
// The demo config imports `examples/payment-rule.ts`; both resolve the package from `work/node_modules`.
cpSync(join(repository, "examples", "payment-rule.ts"), join(work, "payment-rule.ts"));
mkdirSync(join(work, "node_modules", "@aurelienbbn"), { recursive: true });
symlinkSync(packageRoot, join(work, "node_modules", "@aurelienbbn", "agentlint"), "junction");
writeFileSync(join(demo, ".gitignore"), ".agentlint/.cache/\n");
const git = (...args) => execFileSync("git", args, { cwd: demo, stdio: "pipe" });
git("init", "--quiet", "--initial-branch=main");
git("config", "user.email", "demo@example.com");
git("config", "user.name", "agentlint demo");
git("add", "-A");
git("commit", "--quiet", "-m", "demo");

// `check` exits 1 while findings are unresolved, which is what the image shows.
const gate = spawnSync(process.execPath, [bin, "check", "--all", "--base", "main"], {
  cwd: demo,
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1" },
});
if (gate.status !== 1) throw new Error(`Expected a closed gate, got exit ${gate.status}:\n${gate.stderr}`);

const server = spawn(process.execPath, [bin, "review", "--no-open", "--port", "0", "--base", "main"], { cwd: demo });
const url = await new Promise((resolveUrl, reject) => {
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
    const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=\w+/u.exec(output);
    if (match) resolveUrl(match[0]);
  });
  server.on("exit", (code) => reject(new Error(`agentlint review exited with ${code}:\n${output}`)));
});

const browser = await chromium.launch();
try {
  const ui = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await ui.goto(url);
  const shoot = async (name) => {
    await ui.mouse.move(0, 799);
    await ui.waitForTimeout(300);
    const file = join(work, `${name}.png`);
    await ui.screenshot({ path: file });
    return file;
  };
  const open = async (message) => {
    await ui.getByRole("button", { name: message }).click();
    await ui.getByRole("heading", { level: 1 }).waitFor();
  };

  await open(/^Runtime input reaches dynamic code execution/u);
  const proposal = await shoot("proposal");

  await open(/^Customer data crosses an export boundary/u);
  const files = ui.getByRole("complementary", { name: "Files to review together" });
  await files.getByRole("button", { name: /customer-data-exports\.md/u }).click();
  const context = await shoot("context");

  await ui.getByRole("button", { name: /^Decisions/u }).click();
  await ui.waitForTimeout(300);
  const decisions = await shoot("decisions");

  mkdirSync(assets, { recursive: true });
  const frame = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const render = async (name, body) => {
    const page = join(work, `${name}.html`);
    writeFileSync(page, framePage(body));
    await frame.goto(pathToFileURL(page).href);
    await frame.evaluate(() => document.fonts.ready);
    await frame.locator(".stage").screenshot({ path: join(assets, `${name}.png`), omitBackground: true });
  };

  await render("review-hero", browserWindow(proposal, "agentlint review"));
  await render("review-context", browserWindow(context, "agentlint review"));
  await render("review-decisions", browserWindow(decisions, "agentlint review"));
  await render("gate-closed", terminalWindow("pnpm agentlint check --all", gate.stdout));
} finally {
  await browser.close();
  server.kill();
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
console.log(`README assets written to ${assets}`);

function escape(text) {
  return text.replace(/[&<>]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
}

function browserWindow(image, title) {
  return `<div class="window">
  <div class="chrome"><span class="dots"><i></i><i></i><i></i></span><span class="address">${escape(title)}</span></div>
  <img class="shot" src="${pathToFileURL(image).href}" />
</div>`;
}

// Colors only what the CLI already distinguishes in a terminal: the verdict, rule headers, selectors, and hints.
function terminalWindow(command, output) {
  const lines = output
    .replace(/\r/gu, "")
    .trimEnd()
    .split("\n")
    .map((line) => {
      const text = escape(line);
      if (line.endsWith("gate closed")) return `<span class="bad">${text}</span>`;
      if (/^\S+\/\S+ — /u.test(line)) return `<span class="rule">${text}</span>`;
      if (/^ {2}\[\d+\]/u.test(line)) return text.replace(/^( {2})(\[\d+\])/u, `$1<span class="dim">$2</span>`);
      if (/^ {2}Actions:/u.test(line) || /^(Coverage|\d+ accepted|\d+ acceptance)/u.test(line)) {
        return `<span class="dim">${text}</span>`;
      }
      return text;
    });
  return `<div class="window terminal">
  <div class="chrome"><span class="dots"><i></i><i></i><i></i></span><span class="address">Terminal</span></div>
  <pre><span class="prompt">$</span> ${escape(command)}\n${lines.join("\n")}</pre>
</div>`;
}

function framePage(body) {
  const fonts = join(app, "node_modules", "@fontsource-variable");
  const font = (family, file) =>
    `@font-face { font-family: "${family}"; src: url("${pathToFileURL(join(fonts, file)).href}") format("woff2"); font-weight: 100 900; }`;
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
${font("Geist", "geist/files/geist-latin-wght-normal.woff2")}
${font("Geist Mono", "geist-mono/files/geist-mono-latin-wght-normal.woff2")}
html, body { margin: 0; background: transparent; }
body { display: inline-block; }
.stage {
  display: inline-block;
  padding: 56px;
  border-radius: 28px;
  background:
    radial-gradient(120% 90% at 0% 0%, rgba(91, 141, 239, 0.55), transparent 55%),
    radial-gradient(110% 90% at 100% 100%, rgba(168, 85, 247, 0.4), transparent 60%),
    #101018;
}
.window {
  border-radius: 14px;
  overflow: hidden;
  background: #0c0c0d;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 30px 80px rgba(0, 0, 0, 0.55);
}
.chrome {
  position: relative;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #17171b;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font: 500 13px "Geist", sans-serif;
  color: #85858f;
}
.dots { position: absolute; left: 16px; display: flex; gap: 8px; }
.dots i { width: 12px; height: 12px; border-radius: 50%; background: #3a3a42; }
.dots i:nth-child(1) { background: #ff5f57; }
.dots i:nth-child(2) { background: #febc2e; }
.dots i:nth-child(3) { background: #28c840; }
.address { padding: 4px 14px; border-radius: 6px; background: #0f0f12; }
.shot { display: block; width: 1280px; height: 800px; }
.terminal { width: 1180px; }
.terminal pre {
  margin: 0;
  padding: 22px 26px 26px;
  font: 400 14px/1.6 "Geist Mono", monospace;
  color: #d4d4da;
  white-space: pre-wrap;
}
.prompt { color: #5b8def; }
.bad { color: #ff6b6b; font-weight: 600; }
.rule { color: #ececee; font-weight: 600; }
.dim { color: #85858f; }
</style></head>
<body><div class="stage">${body}</div></body></html>`;
}
