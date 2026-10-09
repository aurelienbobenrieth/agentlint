#!/usr/bin/env node
// Retained installed-package and CLI proof. Only writes beneath the caller-owned proof directory.
import { Schema } from "effect";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const tarball = resolve(process.argv[2]);
const proof = resolve(process.argv[3]);
const project = join(proof, "consumer");
assert(!existsSync(project), "Use a fresh proof directory");
mkdirSync(project, { recursive: true });
writeFileSync(
  join(project, "package.json"),
  JSON.stringify({ name: "agentlint-octane-proof", private: true, type: "module" }),
);
const commands = [];
const decodeFinding = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      selector: Schema.String,
      location: Schema.Struct({ file: Schema.String, line: Schema.Number, column: Schema.Number }),
      snippet: Schema.String,
      identity: Schema.Unknown,
    }),
  ),
);
const decodeNext = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      source: Schema.NullOr(Schema.String),
      selector: Schema.NullOr(Schema.String),
      remaining: Schema.Number,
    }),
  ),
);
function run(label, command, args, expected = 0) {
  const result = spawnSync(command, args, { cwd: project, encoding: "utf8", timeout: 120000 });
  const record = { label, command, args, status: result.status, stdout: result.stdout, stderr: result.stderr };
  commands.push(record);
  writeFileSync(join(proof, "commands.json"), JSON.stringify(commands, null, 2));
  assert.equal(result.status, expected, `${label}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
const bin = join(project, "node_modules/@aurelienbbn/agentlint/dist/bin.mjs");
const cli = (label, args, expected) => run(label, process.execPath, [bin, ...args], expected);
run("install plain consumer", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball]);
assert(
  !existsSync(join(project, "node_modules/octane")),
  "Optional compiler must not be installed for plain consumers",
);
cli("init", ["init"]);
run("git init", "git", ["init", "-b", "main"]);
run("git identity", "git", ["config", "user.name", "Octane fixture"]);
run("git email", "git", ["config", "user.email", "octane-fixture@example.invalid"]);
const path = "apps/web/src/features/documents/documents-home.tsrx";
const target = join(project, path);
mkdirSync(dirname(target), { recursive: true });
const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../packages/agentlint/src/__fixtures__/octane");
const before = readFileSync(join(fixtureRoot, "documents-before.tsrx"), "utf8");
const after = readFileSync(join(fixtureRoot, "documents-after.tsrx"), "utf8");
const adapterRegression = `export function Card<V extends string>({ query }: { query: V }) @{
  const state = useLinkedState(query, () => null);
  <div>
    // Authored template comment, not omitted source.
    /* Block comment between template children. */
    @if (true) { <span>{useLinkedState(query, () => 0)}</span> }
    @else if (false) { <span>{useLinkedState(query, () => 1)}</span> }
    @else { <span>{state}</span> }
  </div>
}
export function StatementOnly([query]: readonly string[], ...rest: string[]) @{
  return useLinkedState(query, () => rest);
}
export function Empty() @{}
export function EmptyBranches() @{ @if (true) {} @else if (false) {} @else {} }`;
const rule = `defineRule({ lifecycle: "state", standard: { id: "documents/workspace-state", revision: 1, title: "Workspace search state is scoped to its workspace", guidance: "Search results and errors must be invalidated by workspace changes, even when the query is unchanged." }, detector: { id: "documents/query-only-linked-state", version: 1, match: { pattern: "useLinkedState(query, $INITIAL)", message: "Review query-only search state for missing workspace invalidation." }, fixtures: { mustReport: [{ file: "Card.tsrx", source: 'export function Card() @{ const x = useLinkedState(query, () => 42); <div>{x}</div> }' }, { file: "Branches.tsrx", source: ${JSON.stringify(adapterRegression)} }], mustStaySilent: [{ file: "Card.tsrx", source: 'export function Card() @{ const x = useLinkedState(searchKey, () => 42); <div>{x}</div> }' }, { file: "Branches.tsrx", source: ${JSON.stringify(adapterRegression.replaceAll("query", "searchKey"))} }] } }, binding: { id: "documents/workspace-state", authority: "agent", include: ["${path}"] } })`;
const config = (optIn = true) =>
  `import { defineConfig, defineRule } from "@aurelienbbn/agentlint";\nexport const workspaceRule = ${rule};\nexport default defineConfig({ ${optIn ? 'tsrx: "octane",' : ""} rules: [workspaceRule] });\n`;
const configPath = join(project, ".agentlint/config.ts");
writeFileSync(configPath, config());
writeFileSync(target, before);
writeFileSync(join(project, ".gitignore"), "node_modules/\n");
run("git add", "git", ["add", "."]);
run("git snapshot", "git", ["commit", "-m", "Frozen Octane proof sources"]);
cli("missing optional compiler fails closed", ["check", "--all"], 2);
run("install pinned compiler", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "octane@0.12.1"]);
assert(!existsSync(join(project, "node_modules/@tsrx/oxc")), "Volar scanning does not require the native parser");
assert(!existsSync(join(project, "node_modules/typescript")), "Volar scanning does not require TypeScript");
cli("CLI fixtures", ["rules", "test"]);
const check = (label, expected = 0) =>
  cli(label, ["check", "--all", "--format", "jsonl"], expected).trim().split("\n").filter(Boolean).map(decodeFinding);
writeFileSync(target, adapterRegression);
const regressionHits = check("adapter regression authored findings", 1);
assert.equal(regressionHits.length, 4);
for (const [index, hit] of regressionHits.entries()) {
  const line = adapterRegression.split("\n")[hit.location.line - 1];
  assert(line.slice(hit.location.column - 1).startsWith(hit.snippet));
  cli(`accept adapter regression ${index}`, [
    "accept",
    hit.selector,
    "--reason",
    "Disposable adapter regression proof.",
  ]);
}
assert.equal(check("adapter regression accepted gate").length, 0);
writeFileSync(target, "\n" + adapterRegression.replaceAll("  ", "    "));
assert.equal(check("adapter regression formatting retains acceptance").length, 0);
writeFileSync(target, adapterRegression.replace("() => 0", "() => 2"));
assert.equal(check("adapter regression authored change reopens review", 1).length, 4);
writeFileSync(target, before);
const baseline = [];
for (let repeat = 0; repeat < 3; repeat++) {
  const result = check(`before ${repeat}`, 1);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((hit) => [hit.location.file, hit.location.line, hit.location.column]),
    [
      [path, 54, 28],
      [path, 55, 28],
    ],
  );
  for (const hit of result) {
    const line = before.split("\n")[hit.location.line - 1];
    assert(line.slice(hit.location.column - 1).startsWith(hit.snippet));
  }
  baseline.push(result);
}
assert.deepEqual(baseline[0], baseline[1]);
assert.deepEqual(baseline[1], baseline[2]);
const handoffText = cli("authored review handoff", ["next", "--format", "json"], 1);
const handoff = decodeNext(handoffText);
writeFileSync(join(proof, "handoff.json"), handoffText);
assert.equal(handoff.source, before);
for (let i = 0; i < 2; i++)
  cli(`accept authored finding ${i}`, [
    "accept",
    baseline[0][i].selector,
    "--reason",
    "Disposable fixture acceptance for lifecycle proof.",
  ]);
assert.equal(check("accepted gate opens").length, 0);
writeFileSync(target, "\n" + before.replaceAll("\t", "    "));
assert.equal(check("formatting retains acceptance").length, 0);
writeFileSync(target, before.replace('() => ""', '() => "changed"'));
assert.equal(check("authored evidence reopens review", 1).length, 2);
writeFileSync(target, "export function Broken() @{ <div>{useLinkedState(}</div> }");
cli("malformed source cannot satisfy acceptance", ["check", "--all"], 2);
cli("malformed source cannot be accepted", ["accept", "1", "--reason", "Must fail"], 2);
writeFileSync(target, before);
writeFileSync(configPath, config(false));
cli("missing opt-in fails closed", ["check", "--all"], 2);
writeFileSync(configPath, config());
const compiler = join(project, "node_modules/octane/dist/compiler/volar.js");
const realCompiler = readFileSync(compiler);
writeFileSync(compiler, 'export function compileToVolarMappings() { throw new Error("Broken compiler proof"); }');
cli("broken compiler cannot satisfy acceptance", ["check", "--all"], 2);
cli("broken compiler cannot be accepted", ["accept", "1", "--reason", "Must fail"], 2);
writeFileSync(
  compiler,
  'export function compileToVolarMappings() { return {errors: [], sourceAst: {type: "Program", start: 0, end: 1, body: []}}; }',
);
cli("partial compiler AST cannot satisfy acceptance", ["check", "--all"], 2);
writeFileSync(
  compiler,
  'export function compileToVolarMappings(source) { return {errors: [], sourceAst: {type: "Program", start: 0, end: source.length, body: []}}; }',
);
cli("empty full-span AST cannot satisfy acceptance", ["check", "--all"], 2);
cli("empty full-span AST cannot be accepted", ["accept", "1", "--reason", "Must fail"], 2);
writeFileSync(join(dirname(compiler), "agentlint-proof-original.js"), realCompiler);
const incompleteCompiler = (mutation) =>
  `import { compileToVolarMappings as original } from "./agentlint-proof-original.js";
export function compileToVolarMappings(...args) {
  const compiled = original(...args);
  ${mutation}
  return compiled;
}`;
writeFileSync(compiler, incompleteCompiler("delete compiled.sourceAst.body[0].declaration.body.render;"));
writeFileSync(target, "export function MissingRender() @{ const state = useLinkedState(query, () => 0); }");
cli("missing render field is not a legitimate null render", ["check", "--all"], 2);
cli("missing render field cannot be accepted", ["accept", "1", "--reason", "Must fail"], 2);
writeFileSync(compiler, incompleteCompiler("compiled.sourceAst.body[0].declaration.body.render.children = [];"));
writeFileSync(target, "export function OmittedText() @{ <div>Authored template text</div> }");
cli("omitted template text is not comment trivia", ["check", "--all"], 2);
cli("omitted template text cannot be accepted", ["accept", "1", "--reason", "Must fail"], 2);
writeFileSync(
  compiler,
  incompleteCompiler(`const render = compiled.sourceAst.body[0].declaration.body.render;
const child = render.children[0];
render.children[0] = {type: "JSXExpressionContainer", start: child.start, end: child.end,
expression: {type: "JSXEmptyExpression", start: child.start, end: child.end}};`),
);
cli("fake native comment cannot hide authored text", ["check", "--all"], 2);
cli("fake native comment cannot be accepted", ["accept", "1", "--reason", "Must fail"], 2);
assert(commands.at(-1).stderr.includes("invalid authored native comment"));
writeFileSync(compiler, realCompiler);
writeFileSync(target, before);
const compilerPackage = join(project, "node_modules/octane/package.json");
const realPackage = readFileSync(compilerPackage);
for (const unsupportedVersion of ["0.10.0", "0.12.2"]) {
  writeFileSync(
    compilerPackage,
    realPackage.toString().replace('"version": "0.12.1"', `"version": "${unsupportedVersion}"`),
  );
  cli(`unqualified compiler ${unsupportedVersion} fails closed`, ["check", "--all"], 2);
}
writeFileSync(compilerPackage, realPackage);
writeFileSync(target, after);
for (let repeat = 0; repeat < 3; repeat++) {
  const result = check(`after ${repeat}`);
  assert.equal(result.length, 0);
}
writeFileSync(
  join(project, "fixtures.mjs"),
  `import { Schema } from "effect";
import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { createJiti } from "jiti";\nimport { testRuleOnSource, testRuleFixtures } from "@aurelienbbn/agentlint/testing";\nconst {workspaceRule} = await createJiti(import.meta.url).import("./.agentlint/config.ts");\nconst before = readFileSync("./before.tsrx", "utf8");\nconst hits = await testRuleOnSource({rule: workspaceRule, source: before, file: "${path}", tsrx: "octane"});\nassert.deepEqual(hits.map(hit => [hit.line,hit.column]), [[54,28],[55,28]]);\nassert.deepEqual((await testRuleFixtures(workspaceRule, {tsrx:"octane"})).failures, []);\nconsole.log(JSON.stringify(hits,null,2));\n`,
);
writeFileSync(join(project, "before.tsrx"), before);
run("installed public testing route", process.execPath, ["fixtures.mjs"]);
const hash = (content) => createHash("sha256").update(content).digest("hex");
writeFileSync(
  join(proof, "manifest.json"),
  JSON.stringify(
    {
      tarball,
      tarballSha256: hash(readFileSync(tarball)),
      path,
      beforeSha256: hash(before),
      afterSha256: hash(after),
      compilerSha256: hash(realCompiler),
      node: process.version,
      octane: "0.12.1",
      nativeParserInstalled: existsSync(join(project, "node_modules/@tsrx/oxc")),
      typescriptInstalled: existsSync(join(project, "node_modules/typescript")),
      frontend: "octane/compiler/volar bundled editor parser",
      assertions: "passed",
      commands: commands.length,
    },
    null,
    2,
  ),
);
cpSync(join(project, "package-lock.json"), join(proof, "consumer-package-lock.json"));
console.log(`Octane installed-package proof passed. ${commands.length} commands retained in ${proof}`);
