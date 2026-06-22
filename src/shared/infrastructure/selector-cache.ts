/**
 * Latest-check selector cache.
 *
 * This cache is an ephemeral convenience index for human-friendly selectors.
 * The ledger remains the only public durable state.
 *
 * @module
 * @since 0.2.0
 */

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Env } from "../../config/env.js";

export const SelectorCacheEntry = Schema.Struct({
  selector: Schema.String,
  hash: Schema.String,
  ruleId: Schema.String,
  file: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
});

export type SelectorCacheEntry = Schema.Schema.Type<typeof SelectorCacheEntry>;

export const SelectorCachePayload = Schema.Struct({
  version: Schema.Literal(1),
  findings: Schema.Array(SelectorCacheEntry),
});

export type SelectorCachePayload = Schema.Schema.Type<typeof SelectorCachePayload>;

const CACHE_PATH = [".agentlint", ".cache", "last-check.json"] as const;
const PayloadDecoder = Schema.decodeUnknownSync(SelectorCachePayload);

export class SelectorCache extends Context.Service<
  SelectorCache,
  {
    read(): Effect.Effect<SelectorCachePayload>;
    write(entries: ReadonlyArray<SelectorCacheEntry>): Effect.Effect<void>;
  }
>()("agentlint/SelectorCache") {
  static readonly layer: Layer.Layer<SelectorCache, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    SelectorCache,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cacheDir = path.resolve(env.cwd, ".agentlint", ".cache");
      const cachePath = path.resolve(env.cwd, ...CACHE_PATH);

      return SelectorCache.of({
        read: () =>
          fs.exists(cachePath).pipe(
            Effect.orElseSucceed(() => false),
            Effect.flatMap((exists) => {
              if (!exists) return Effect.succeed({ version: 1 as const, findings: [] });
              return fs.readFileString(cachePath).pipe(
                Effect.map((content) => PayloadDecoder(JSON.parse(content))),
                Effect.orElseSucceed(() => ({ version: 1 as const, findings: [] })),
              );
            }),
          ),

        write: (entries) =>
          Effect.gen(function* () {
            const payload: SelectorCachePayload = { version: 1, findings: [...entries] };
            PayloadDecoder(payload);
            yield* fs.makeDirectory(cacheDir, { recursive: true });
            yield* fs.writeFileString(cachePath, JSON.stringify(payload, null, 2) + "\n");
          }).pipe(Effect.orElseSucceed(() => undefined)),
      });
    }),
  );
}
