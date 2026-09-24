export interface FixtureFailure {
  readonly expectation: "mustReport" | "mustStaySilent" | "deterministic";
  readonly index: number;
  readonly label?: string | undefined;
  readonly findingCount: number;
}

export interface FixtureReport {
  readonly ruleId: string;
  readonly total: number;
  readonly failures: ReadonlyArray<FixtureFailure>;
}
