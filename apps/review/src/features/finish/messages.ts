import { Schema as S } from "effect";

export const fields = {
  ClickedFinish: {},
  PreparedDetachedFinish: { acceptedAt: S.String },
  CompletedFinish: { summary: S.String, feedback: S.String, acceptanceOutput: S.String },
  FailedFinish: { message: S.String },
  ClickedCopyInstructions: {},
  ClickedDownloadAcceptances: {},
} satisfies Record<string, S.Struct.Fields>;
