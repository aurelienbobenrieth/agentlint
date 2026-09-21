import { describe, expect, it } from "vitest";
import { defineRule, type RuleMatch } from "../../domain/rule.js";
import { testRuleOnSource } from "../../testing.js";

const ruleFor = (match: RuleMatch) =>
  defineRule({
    lifecycle: "state",
    standard: { id: "test/standard", revision: 1, title: "Test standard", guidance: "Test standard." },
    detector: { id: "test/trigger", version: 1, match },
    binding: { id: "test/pattern", authority: "agent" },
  });

/** What a rule author sees: the matched code and the rendered message. */
const matches = async (match: RuleMatch, source: string, file = "fixture.ts") =>
  (await testRuleOnSource(ruleFor(match), source, file)).map(
    (finding) => `${finding.line}: ${finding.sourceSnippet} -> ${finding.message}`,
  );

describe("pattern placeholders", () => {
  it("lets a sequence placeholder stand for zero, one, or many arguments", async () => {
    expect(await matches({ pattern: "run($$$ARGS)", message: "run" }, "run(); run(1); run(1, 2); other(1);")).toEqual([
      "1: run() -> run",
      "1: run(1) -> run",
      "1: run(1, 2) -> run",
    ]);
  });

  it("requires the exact arity and literals that the pattern spells out", async () => {
    expect(
      await matches({ pattern: "setTimeout($FN, 0)", message: "zero delay" }, "setTimeout(f, 0); setTimeout(f, 10);"),
    ).toEqual(["1: setTimeout(f, 0) -> zero delay"]);
    expect(
      await matches({ pattern: "pair($_, $B)", message: "second is $B" }, "pair(1); pair(1, 2); pair(1, 2, 3);"),
    ).toEqual(["1: pair(1, 2) -> second is 2"]);
  });

  it("matches the written member path and not a longer or different one", async () => {
    expect(
      await matches(
        { pattern: "console.log($$$ARGS)", message: "log" },
        "console.log(1); console.error(2); window.console.log(3); log(4);",
      ),
    ).toEqual(["1: console.log(1) -> log"]);
  });

  it("leaves an unknown placeholder in the message visible instead of hiding the mistake", async () => {
    expect(await matches({ pattern: "run($A)", message: "got $A and $MISSING" }, "run(1)")).toEqual([
      "1: run(1) -> got 1 and $MISSING",
    ]);
  });

  it("reports every occurrence on its own line, including identical code", async () => {
    expect(
      await matches({ pattern: "danger($A)", message: "danger $A" }, "danger(1);\n\ndanger(1);\n  danger(\n 2);"),
    ).toEqual(["1: danger(1) -> danger 1", "3: danger(1) -> danger 1", "4: danger( -> danger 2"]);
  });
});

describe("where constraints", () => {
  it("combines a required and a forbidden subtree", async () => {
    expect(
      await matches(
        { pattern: "fetch($$$ARGS)", where: { has: "method: $_", notHas: "signal" }, message: "unbounded write" },
        "fetch('/a'); fetch('/b', { method: 'POST' }); fetch('/c', { method: 'POST', signal });",
      ),
    ).toEqual(["1: fetch('/b', { method: 'POST' }) -> unbounded write"]);
  });

  it("reads a key-value constraint as an object property", async () => {
    expect(
      await matches(
        { pattern: "$DB.findMany($$$ARGS)", where: { notHas: "take: $_" }, message: "$DB is unbounded" },
        "db.a.findMany({}); db.b.findMany({ take: 5 }); db.c.findMany({ orderBy: 'id', take: limit });",
      ),
    ).toEqual(["1: db.a.findMany({}) -> db.a is unbounded"]);
  });
});

describe("languages", () => {
  it("matches JSX in a TSX file", async () => {
    expect(
      await matches({ pattern: "<Button $$$PROPS />", message: "button" }, 'const a = <Button kind="x" />;', "a.tsx"),
    ).toEqual(['1: <Button kind="x" /> -> button']);
  });

  it("matches plain JavaScript", async () => {
    expect(await matches({ pattern: "eval($$$ARGS)", message: "eval" }, "eval('x')", "legacy.js")).toEqual([
      "1: eval('x') -> eval",
    ]);
  });

  it("matches a JSON property by pattern and by query", async () => {
    const manifest = '{\n  "name": "x",\n  "private": false,\n  "scripts": { "postinstall": "node x.js" }\n}';
    expect(
      await matches({ pattern: '{ "private": false }', message: "public package" }, manifest, "package.json"),
    ).toEqual(['3: "private": false -> public package']);
    expect(
      await matches(
        {
          query: '(pair key: (string (string_content) @key (#eq? @key "postinstall"))) @match',
          message: "install script @key",
        },
        manifest,
        "package.json",
      ),
    ).toEqual(['4: "postinstall": "node x.js" -> install script postinstall']);
  });

  it("rejects a pattern that is not valid in the file's language", async () => {
    await expect(matches({ pattern: '"private": false', message: "x" }, "{}", "package.json")).rejects.toThrow(
      "does not parse as json",
    );
  });
});

describe("raw queries", () => {
  it("reports the first capture when the query names no @match", async () => {
    expect(
      await matches({ query: "(call_expression function: (identifier) @fn)", message: "call @fn" }, "go(1)"),
    ).toEqual(["1: go -> call go"]);
  });
});

describe("repeated placeholders and overlapping matches", () => {
  it("requires a repeated placeholder to name the same code", async () => {
    expect(
      await matches(
        { pattern: "$A === $A", message: "$A is compared with itself" },
        "x === x; x === y; a.b === a . b;",
      ),
    ).toEqual(["1: x === x -> x is compared with itself", "1: a.b === a . b -> a.b is compared with itself"]);
  });

  it("reports a node once and names it after the first declared match that applies", async () => {
    const rule = defineRule({
      lifecycle: "state",
      standard: { id: "test/standard", revision: 1, title: "Test standard", guidance: "Test standard." },
      detector: {
        id: "test/trigger",
        version: 1,
        match: [
          { pattern: "eval($$$ARGS)", message: "eval" },
          { pattern: "$FN($$$ARGS)", where: { has: "unsafe" }, message: "unsafe call to $FN" },
          { query: "(call_expression) @match", message: "any call" },
        ],
      },
      binding: { id: "test/pattern", authority: "agent" },
    });
    const findings = await testRuleOnSource(rule, "eval(unsafe);\nrun(unsafe);\nrun(safe);");
    expect(findings.map((finding) => `${finding.line}: ${finding.message}`)).toEqual([
      "1: eval",
      "2: unsafe call to run",
      "3: any call",
    ]);
  });
});

describe("property constraints", () => {
  const unbounded = { pattern: "$DB.findMany($$$ARGS)", where: { notHas: "take: $_" }, message: "$DB" };

  it("accepts the shorthand form of the property", async () => {
    expect(await matches(unbounded, "const take = 5; db.a.findMany({ take }); db.b.findMany({ skip });")).toEqual([
      "1: db.b.findMany({ skip }) -> db.b",
    ]);
  });

  it("does not read a property of a nested value as an option of the call", async () => {
    expect(
      await matches(
        unbounded,
        "db.a.findMany({ where: { take: 1 } }); db.b.findMany({ where: { take: 1 }, take: 5 });",
      ),
    ).toEqual(["1: db.a.findMany({ where: { take: 1 } }) -> db.a"]);
  });

  it("still finds a bare identifier anywhere in the matched code", async () => {
    expect(
      await matches(
        { pattern: "fetch($$$ARGS)", where: { notHas: "signal" }, message: "no signal" },
        "fetch('/a', { init: { signal } }); fetch('/b', { init: {} });",
      ),
    ).toEqual(["1: fetch('/b', { init: {} }) -> no signal"]);
  });
});
