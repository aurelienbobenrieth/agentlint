import { describe, expect, it } from "vitest";
import { actorKind, actorLabel } from "./labels";

describe("actorLabel", () => {
  it("names the principal and leaves details to the title", () => {
    expect(
      ["human:aurel", "agent:codex?session=019a&user=aurel", "human:local-review", "ci-bot"].map(actorLabel),
    ).toEqual(["aurel", "codex", "local-review", "ci-bot"]);
    expect(actorKind("agent:claude?user=aurel")).toBe("agent");
  });
});
