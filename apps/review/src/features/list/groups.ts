import type { ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";

/**
 * Connected components of explicit file relationships. Presentation only; decisions remain individual.
 */
export const relatedGroups = (findings: ReadonlyArray<ReviewFindingPayload>): ReadonlyMap<string, string> => {
  const parents = new Map<string, string>();
  const owners = new Map<string, string>();
  const root = (id: string): string => {
    let current = id;
    while (parents.has(current) && parents.get(current) !== current) current = parents.get(current) ?? current;
    let child = id;
    while (parents.has(child) && parents.get(child) !== current) {
      const next = parents.get(child) ?? current;
      parents.set(child, current);
      child = next;
    }
    return current;
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
