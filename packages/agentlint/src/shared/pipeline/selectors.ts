/**
 * Human-friendly finding selector resolution.
 *
 * Supported selectors:
 * - latest-check ordinals: `1` or `[1]`
 * - full finding hash
 * - `file:line`
 *
 * @module
 * @since 0.2.0
 */

import type { FindingRecord } from "../../domain/finding.js";
import type { SelectorCachePayload } from "../infrastructure/selector-cache.js";

export type SelectorResolution =
  | { readonly ok: true; readonly finding: FindingRecord }
  | { readonly ok: false; readonly message: string };

function normalizeSelector(selector: string): string {
  return selector.trim().replace(/^\[(\d+)\]$/, "$1");
}

function resolveHashFromCache(selector: string, cache: SelectorCachePayload): string | undefined {
  const normalized = normalizeSelector(selector);
  return cache.findings.find((entry) => entry.selector === normalized)?.hash;
}

export function resolveFindingSelector(
  selector: string,
  findings: ReadonlyArray<FindingRecord>,
  cache: SelectorCachePayload,
): SelectorResolution {
  const normalized = normalizeSelector(selector);
  const cachedHash = resolveHashFromCache(normalized, cache);
  const hash = cachedHash ?? normalized;

  const hashMatch = findings.find((finding) => finding.hash === hash);
  if (hashMatch) {
    return { ok: true, finding: hashMatch };
  }

  const fileLineMatch = normalized.match(/^(.+):(\d+)$/);
  if (fileLineMatch) {
    const [, rawFile, rawLine] = fileLineMatch;
    if (!rawFile || !rawLine) {
      return {
        ok: false,
        message: `No current finding matches "${selector}". Rerun agentlint check if the selector is stale.`,
      };
    }

    const file = rawFile.replace(/\\/g, "/");
    const line = Number(rawLine);
    const matches = findings.filter((finding) => finding.file === file && finding.line === line);
    const [match] = matches;
    if (matches.length === 1 && match) {
      return { ok: true, finding: match };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        message: `Selector "${selector}" is ambiguous. Use the latest-check ordinal or hash.`,
      };
    }
  }

  return {
    ok: false,
    message: `No current finding matches "${selector}". Rerun agentlint check if the selector is stale.`,
  };
}
