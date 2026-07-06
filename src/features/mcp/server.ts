/**
 * MCP server: exposes the agentlint loop as tools over stdio.
 *
 * Any MCP-capable harness (Claude Code, Cursor, Codex, ...) can register
 * `agentlint mcp` and get check/explain/resolve/rules as discoverable tools.
 * `approve` is deliberately not exposed: approvals are reserved for humans
 * through the CLI or the review UI.
 *
 * Nothing may write to stdout here except the MCP transport - the protocol
 * runs on it.
 *
 * @module
 * @since 0.2.0
 */

import { Effect, FileSystem, Path } from "effect";
import type { Context } from "effect";
import { Env } from "../../config/env.js";
import { normalizeConfig } from "../../domain/config.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { NotesStore } from "../../shared/infrastructure/notes-store.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { formatCheckJsonl, formatNotesJsonl } from "../../cli/reporter.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";
import { explainHandler } from "../explain/handler.js";
import { ExplainCommand } from "../explain/request.js";
import { ledgerReviewHandler } from "../ledger/handler.js";
import { LedgerReviewCommand } from "../ledger/request.js";
import { resolveHandler } from "../resolve/handler.js";
import { ResolveCommand } from "../resolve/request.js";
import { rulesListHandler, rulesTestHandler } from "../rules/handler.js";
import { RulesListCommand, RulesTestCommand } from "../rules/request.js";

type McpServices =
  | Env
  | FileSystem.FileSystem
  | Path.Path
  | ConfigLoader
  | Git
  | LedgerStore
  | NotesStore
  | Parser
  | SelectorCache;

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/**
 * Run the MCP stdio server until the client disconnects.
 *
 * @since 0.2.0
 */
export const runMcpServer = Effect.fn("runMcpServer")(function* (version: string) {
  const services: Context.Context<McpServices> = yield* Effect.context<McpServices>();
  const run = <A, E>(effect: Effect.Effect<A, E, McpServices>): Promise<A> =>
    Effect.runPromise(Effect.provideContext(effect, services));

  yield* Effect.tryPromise({
    try: async () => {
      const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      const { z } = await import("zod");

      const server = new McpServer({ name: "agentlint", version });

      server.registerTool(
        "check",
        {
          description:
            "Scan changed files (or all files) for agentlint findings. Returns one JSON object per unresolved finding plus matched context notes. Exit semantics: findings must be fixed or resolved before completion.",
          inputSchema: {
            all: z.boolean().optional().describe("Scan all files instead of git-changed files"),
            files: z.array(z.string()).optional().describe("Explicit file paths to scan"),
            rule: z.string().optional().describe("Only run this rule id (comma-separated for several)"),
            ci: z.boolean().optional().describe("Also treat deferred and pending-approval findings as blocking"),
          },
        },
        async (args) => {
          const result = await run(
            checkHandler(
              new CheckCommand({
                all: args.all ?? false,
                rules: args.rule ? args.rule.split(",").map((part) => part.trim()) : [],
                base: undefined,
                files: args.files ?? [],
                format: "jsonl",
                ci: args.ci ?? false,
              }),
            ),
          );
          const config = normalizeConfig(
            await run(
              Effect.gen(function* () {
                const configLoader = yield* ConfigLoader;
                return yield* configLoader.load();
              }),
            ),
          );
          const body = [formatCheckJsonl(result.displayedFindings, config), formatNotesJsonl(result.notes)]
            .filter((part) => part.length > 0)
            .join("\n");
          const summary = JSON.stringify({
            unresolved: result.unresolvedCount,
            resolved: result.resolvedCount,
            deferred: result.deferredCount,
            pendingApproval: result.pendingApprovalCount,
            blocking: result.exitCode === 1,
          });
          return textResult([summary, body].filter((part) => part.length > 0).join("\n"));
        },
      );

      server.registerTool(
        "explain",
        {
          description:
            "Full guidance for a rule id or a finding selector from the latest check: standard, checks, examples, refs, and ledger context.",
          inputSchema: {
            selector: z.string().describe("Rule id, latest-check ordinal (e.g. '1'), or finding hash"),
          },
        },
        async (args) => {
          const result = await run(explainHandler(new ExplainCommand({ selector: args.selector })));
          return textResult(result.output, !result.found);
        },
      );

      server.registerTool(
        "resolve",
        {
          description:
            "Record a disposition for a finding: accepted, deferred, no_fix, or approval_requested (for human-gated rules). Every disposition needs a concrete reason. Approvals themselves are human-only and are not available here.",
          inputSchema: {
            selector: z.string().describe("Latest-check ordinal or finding hash"),
            status: z.enum(["accepted", "deferred", "no_fix", "approval_requested"]),
            reason: z.string().describe("Concrete justification recorded in the committed ledger"),
          },
        },
        async (args) => {
          const result = await run(
            resolveHandler(
              new ResolveCommand({
                selector: args.selector,
                status: args.status,
                reason: args.reason,
                actor: undefined,
                interactive: false,
              }),
            ),
          );
          return textResult(result.message, result.exitCode !== 0);
        },
      );

      server.registerTool(
        "rules_list",
        {
          description: "List configured rule ids with descriptions, compact standards, and persistence.",
          inputSchema: {},
        },
        async () => {
          const result = await run(rulesListHandler(new RulesListCommand({ file: undefined })));
          const lines = result.rules.map((rule) =>
            JSON.stringify({
              id: rule.id,
              description: rule.description,
              persistence: rule.persistence,
              standard: rule.standard,
            }),
          );
          return textResult(lines.join("\n"));
        },
      );

      server.registerTool(
        "rules_test",
        {
          description: "Run rule fixtures: invalid snippets must produce findings, valid snippets none.",
          inputSchema: {
            rule: z.string().optional().describe("Only test this rule id"),
          },
        },
        async (args) => {
          const result = await run(rulesTestHandler(new RulesTestCommand({ rules: args.rule ? [args.rule] : [] })));
          return textResult(result.message, result.exitCode !== 0);
        },
      );

      server.registerTool(
        "ledger_review",
        {
          description:
            "Summarize pending human approvals and ledger dispositions added since a git base ref. Useful before opening a PR.",
          inputSchema: {
            base: z.string().optional().describe("Git ref to diff the ledger against (default: default branch)"),
          },
        },
        async (args) => {
          const result = await run(ledgerReviewHandler(new LedgerReviewCommand({ base: args.base, format: "jsonl" })));
          return textResult(result.message);
        },
      );

      const transport = new StdioServerTransport();
      await server.connect(transport);
      await new Promise<void>((resolvePromise) => {
        // MCP transports expose a plain `onclose` property, not EventTarget.
        // oxlint-disable-next-line unicorn/prefer-add-event-listener
        transport.onclose = () => resolvePromise();
      });
    },
    catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
  });
});
