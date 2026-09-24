import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const SOURCE_ROOTS = ["packages/agentlint/src", "apps/review/src", "action/src"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs"]);

const portable = (path) => path.split(sep).join("/");

const filesBelow = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.match(/\.test\.[^.]+$/u) &&
      !path.includes(`${sep}__fixtures__${sep}`)
      ? [path]
      : [];
  });

const importsOf = (source) => {
  const imports = [];
  const staticImport = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(pattern)) imports.push(match[1]);
  }
  return imports;
};

const resolveLocal = ({ importer, specifier, known }) => {
  if (!specifier.startsWith(".")) return undefined;
  const raw = resolve(dirname(importer), specifier);
  const base = raw.replace(/\.(?:m?js)$/u, "");
  return [raw, ...[".ts", ".tsx", ".mts", ".js", ".mjs"].map((extension) => `${base}${extension}`)].find(
    (candidate) => existsSync(candidate) && known.has(candidate),
  );
};

export const architecture = () => {
  const files = SOURCE_ROOTS.flatMap((root) => filesBelow(resolve(ROOT, root)));
  const known = new Set(files);
  const modules = new Map();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const imports = importsOf(source);
    modules.set(file, {
      id: portable(relative(ROOT, file)),
      file,
      source,
      imports,
      dependencies: imports.flatMap((specifier) => {
        const dependency = resolveLocal({ importer: file, specifier, known });
        return dependency === undefined ? [] : [dependency];
      }),
    });
  }
  return { root: ROOT, modules };
};

export const stronglyConnected = (modules) => {
  const state = { index: 0 };
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const active = new Set();
  const components = [];

  const visit = (file) => {
    const index = state.index++;
    indices.set(file, index);
    lowLinks.set(file, index);
    stack.push(file);
    active.add(file);
    for (const dependency of modules.get(file)?.dependencies ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(dependency)));
      } else if (active.has(dependency)) {
        lowLinks.set(file, Math.min(lowLinks.get(file), indices.get(dependency)));
      }
    }
    if (lowLinks.get(file) !== indices.get(file)) return;
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      active.delete(member);
      component.push(member);
      if (member === file) break;
    }
    if (component.length > 1 || modules.get(file)?.dependencies.includes(file)) components.push(component);
  };

  for (const file of modules.keys()) if (!indices.has(file)) visit(file);
  return components;
};
