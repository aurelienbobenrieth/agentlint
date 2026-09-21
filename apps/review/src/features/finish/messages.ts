import { Schema as S } from "effect";

import { ExportKind } from "../../model";

export const fields = {
  ClickedFinish: {},
  ClickedDownloadCalibration: {},
  PreparedDetachedFinish: { acceptedAt: S.String },
  CompletedFinish: { summary: S.String, feedback: S.String, acceptanceOutput: S.String },
  FailedFinish: { message: S.String },
  ClickedCopyInstructions: {},
  ClickedDownloadAcceptances: {},
  /**
   * An output of the finished review reached the clipboard or the disk.
   */
  ExportedOutput: { kind: ExportKind, message: S.String },
} satisfies Record<string, S.Struct.Fields>;
