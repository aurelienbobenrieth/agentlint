/**
 * Shared command-line flags and arguments. @module
 */

import { Option } from "effect";
import { Argument, Flag } from "effect/unstable/cli";
import { ruleIds } from "./flags.js";

const optionalString = ({
  name,
  metavar,
  description,
}: {
  readonly name: string;
  readonly metavar: string;
  readonly description: string;
}) =>
  Flag.String(name).pipe(
    Flag.withMetavar(metavar),
    Flag.withDescription(description),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
  );

export const baseFlag = optionalString({
  name: "base",
  metavar: "ref",
  description: "Git ref used as the change baseline (merge base)",
});

export const ruleFlag = Flag.String("rule").pipe(
  Flag.withMetavar("id"),
  Flag.withDescription("Restrict to a rule id; repeat or comma-separate for several"),
  Flag.atLeast(0),
  Flag.map(ruleIds),
);

export const filesArgument = Argument.String("files").pipe(
  Argument.withDescription("Files or directories to inspect"),
  Argument.variadic(),
);

export const selectorArgument = Argument.String("selector").pipe(
  Argument.withDescription("Finding number from the last check or a full finding key"),
);

export const portFlag = Flag.Int("port").pipe(
  Flag.withDescription("Local server port (0 picks a free port)"),
  Flag.withDefault(0),
  Flag.filter(
    (port) => port >= 0 && port <= 65_535,
    () => "--port must be 0..65535.",
  ),
);

export const openFlag = Flag.Boolean("open").pipe(
  Flag.withDescription("Open the browser; pass --no-open to only print the URL"),
  Flag.withDefault(true),
);

export { optionalString };
