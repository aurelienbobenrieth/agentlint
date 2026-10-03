/**
 * A directory holds its subdirectories, then its files, each sorted by name. A directory with a single subdirectory and
 * no files is folded into it (`src/server`), so a deep path costs one row. A directory's `path` is its full path, the
 * key a reviewer collapses it by.
 */
export type FileTreeNode =
  | {
      readonly kind: "directory";
      readonly name: string;
      readonly path: string;
      readonly children: ReadonlyArray<FileTreeNode>;
    }
  | { readonly kind: "file"; readonly name: string; readonly path: string };

interface MutableDirectory {
  readonly directories: Map<string, MutableDirectory>;
  readonly files: Map<string, string>;
}

const emptyDirectory = (): MutableDirectory => ({ directories: new Map(), files: new Map() });

const byName = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const freeze = (directory: MutableDirectory, prefix: string): ReadonlyArray<FileTreeNode> => [
  ...[...directory.directories]
    .toSorted(([left], [right]) => byName(left, right))
    .map(([name, child]): FileTreeNode => {
      const folded = { name, child };
      while (folded.child.files.size === 0 && folded.child.directories.size === 1) {
        const [[nextName, next]] = [...folded.child.directories] as [[string, MutableDirectory]];
        folded.name = `${folded.name}/${nextName}`;
        folded.child = next;
      }
      const path = `${prefix}${folded.name}`;
      return { kind: "directory", name: folded.name, path, children: freeze(folded.child, `${path}/`) };
    }),
  ...[...directory.files]
    .toSorted(([left], [right]) => byName(left, right))
    .map(([name, path]): FileTreeNode => ({ kind: "file", name, path })),
];

export const fileTree = (paths: ReadonlyArray<string>): ReadonlyArray<FileTreeNode> => {
  const root = emptyDirectory();
  for (const path of new Set(paths)) {
    const segments = path.split("/");
    const name = segments.pop() ?? path;
    const parent = segments.reduce((directory, segment) => {
      const existing = directory.directories.get(segment);
      if (existing !== undefined) return existing;
      const created = emptyDirectory();
      directory.directories.set(segment, created);
      return created;
    }, root);
    parent.files.set(name, path);
  }
  return freeze(root, "");
};
