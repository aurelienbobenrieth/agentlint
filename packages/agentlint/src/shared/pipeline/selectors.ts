/**
 * Human-friendly finding selector resolution.
 *
 * Supported selectors:
 * - latest-check ordinals: `1` or `[1]`
 * - full finding hash, or a unique complete identity digest prefix of at least 7 hex characters
 * - `file:line`
 *
 * @module
 * @since 0.2.0
 */

import { findingId, findingKey, type FindingRecord } from "../../domain/finding.js";
import type { SelectorCachePayload } from "../infrastructure/selector-cache.js";

export type SelectorResolution =
  | { readonly ok: true; readonly finding: FindingRecord }
  | { readonly ok: false; readonly message: string };

/** A hexadecimal digest prefix long enough to be intentional. */
const HASH_PREFIX = /^[0-9a-f]{7,}$/;

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

  const hashMatch = findings.find((finding) => findingKey(finding) === hash);
  if (hashMatch) {
    return { ok: true, finding: hashMatch };
  }

  if (HASH_PREFIX.test(normalized)) {
    const prefixed = findings.filter((finding) => findingId(finding).startsWith(normalized));
    const [match] = prefixed;
    if (prefixed.length === 1 && match) {
      return { ok: true, finding: match };
    }
    if (prefixed.length > 1) {
      return {
        ok: false,
        message: `Selector "${selector}" is ambiguous. Use the latest-check ordinal or a longer hash.`,
      };
    }
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
