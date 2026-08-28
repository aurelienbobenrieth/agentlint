import type { Update } from "foldkit";

import type { Message } from "../message";
import type { Model } from "../model";

export type UpdateReturn = Update.Return<Model, Message>;
export type Commands = Update.Commands<Message>;

/** The `Message.match` handlers a feature owns: exactly one per tag in its `fields`. */
export type Handlers<Tag extends Message["_tag"]> = {
  readonly [T in Tag]: (message: Extract<Message, { readonly _tag: T }>) => UpdateReturn;
};

export const appendCommands = (result: UpdateReturn, commands: Commands): UpdateReturn => ({
  model: result.model,
  commands: [...(result.commands ?? []), ...commands],
});

export const toggle = <T>(values: ReadonlyArray<T>, value: T): ReadonlyArray<T> =>
  values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
