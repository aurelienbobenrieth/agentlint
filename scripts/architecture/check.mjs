import { architecture, stronglyConnected } from "./model.mjs";

const { modules } = architecture();
const violations = [];
const byId = new Map([...modules].map(([file, module]) => [file, module.id]));

for (const component of stronglyConnected(modules)) {
  violations.push(
    `dependency cycle: ${component
      .map((file) => byId.get(file))
      .toSorted()
      .join(" -> ")}`,
  );
}

for (const module of modules.values()) {
  const internal = module.dependencies.map((file) => byId.get(file));
  if (module.id.startsWith("packages/agentlint/src/domain/")) {
    for (const dependency of internal.filter((id) => !id.startsWith("packages/agentlint/src/domain/"))) {
      violations.push(`${module.id}: domain imports outside domain: ${dependency}`);
    }
  }
  if (module.id.startsWith("packages/agentlint/src/shared/")) {
    for (const dependency of internal.filter((id) => id.startsWith("packages/agentlint/src/features/"))) {
      violations.push(`${module.id}: shared code imports a feature: ${dependency}`);
    }
  }
  if (module.id.startsWith("packages/agentlint/src/shared/infrastructure/")) {
    for (const dependency of internal.filter((id) => id.startsWith("packages/agentlint/src/shared/pipeline/"))) {
      violations.push(`${module.id}: infrastructure imports the application pipeline: ${dependency}`);
    }
  }
  if (module.id.startsWith("apps/review/src/shared/")) {
    for (const dependency of internal.filter((id) => id.startsWith("apps/review/src/features/"))) {
      violations.push(`${module.id}: review shared code imports a feature: ${dependency}`);
    }
  }
  if (module.id === "packages/agentlint/src/features/review/contract.ts") {
    for (const dependency of module.imports.filter(
      (specifier) => !specifier.startsWith(".") && specifier !== "effect",
    )) {
      violations.push(`${module.id}: browser contract imports ${dependency}; only effect is allowed`);
    }
  }
  if (module.id.startsWith("packages/agentlint/src/")) {
    // Failures are tagged errors with structured fields. An untagged Error hides the failure shape from callers and
    // from the typed error channel.
    for (const [index, line] of module.source.split("\n").entries()) {
      if (/\bnew Error\(/u.test(line)) {
        violations.push(`${module.id}:${index + 1}: untagged Error; use a Schema.TaggedError with structured fields`);
      }
    }
  }
  if (module.id.startsWith("action/src/")) {
    for (const dependency of module.imports.filter(
      (specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:"),
    )) {
      violations.push(`${module.id}: standalone Action has a runtime package dependency: ${dependency}`);
    }
  }
}

if (violations.length > 0) {
  console.error(["Architecture check failed:", ...violations.map((violation) => `- ${violation}`)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed (${modules.size} production modules, no cycles or boundary violations).`);
}
