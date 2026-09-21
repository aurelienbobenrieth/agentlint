import type { ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";

/**
 * Connected components of explicit file relationships. Presentation only; decisions remain individual.
 */
export const relatedGroups = (findings: ReadonlyArray<ReviewFindingPayload>): ReadonlyMap<string, string> => {
  const parents = new Map<string, string>();
  const owners = new Map<string, string>();
  const root = (id: string): string => {
    const parent = parents.get(id);
    if (parent === undefined || parent === id) return id;
    const resolved = root(parent);
    parents.set(id, resolved);
    return resolved;
  };
  for (const finding of findings) {
    parents.set(finding.id, finding.id);
    for (const file of new Set([finding.file, ...finding.relatedFiles])) {
      const owner = owners.get(file);
      if (owner === undefined) owners.set(file, finding.id);
      else {
        const a = root(owner);
        const b = root(finding.id);
        if (a !== b) parents.set(a < b ? b : a, a < b ? a : b);
      }
    }
  }
  return new Map(findings.map((finding) => [finding.id, root(finding.id)]));
};
