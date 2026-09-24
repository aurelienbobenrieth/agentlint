/**
 * Safe repository path inspection shared by filesystem adapters. @module
 */

import { Effect, type FileSystem, type Path, type PlatformError } from "effect";

export function toRepositoryPath({ value, separator }: { readonly value: string; readonly separator: string }): string {
  return separator === "\\" ? value.replace(/\\/g, "/") : value;
}

export function isInside({
  path,
  root,
  candidate,
}: {
  readonly path: Path.Path;
  readonly root: string;
  readonly candidate: string;
}): boolean {
  const relative = path.relative(root, candidate);
  return !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

export type RepositoryEntry =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Escapes"; readonly linkTarget: string | undefined }
  | { readonly _tag: "Inside"; readonly realPath: string; readonly linkTarget: string | undefined };

/**
 * Resolve links and reject entries outside the repository or inside its Git metadata.
 */
export const inspectRepositoryEntry: (input: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly canonicalRoot: string;
  readonly file: string;
}) => Effect.Effect<RepositoryEntry, PlatformError.PlatformError> = Effect.fn("inspectRepositoryEntry")(function* ({
  fs,
  path,
  canonicalRoot,
  file,
}) {
  const lexical = path.resolve(canonicalRoot, file);
  const real = yield* fs.realPath(lexical).pipe(
    Effect.map((value): string | undefined => value),
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed(undefined),
    ),
  );
  const linkTarget =
    real === lexical ? undefined : yield* fs.readLink(lexical).pipe(Effect.orElseSucceed(() => undefined));
  if (real === undefined) return linkTarget === undefined ? { _tag: "Missing" } : { _tag: "Escapes", linkTarget };
  if (
    !isInside({ path, root: canonicalRoot, candidate: real }) ||
    isInside({ path, root: path.resolve(canonicalRoot, ".git"), candidate: real })
  )
    return { _tag: "Escapes", linkTarget };
  return { _tag: "Inside", realPath: real, linkTarget };
});
