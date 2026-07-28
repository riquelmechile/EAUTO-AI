export const ACCOUNT_BRAIN_DIMENSIONS = [
  "economics",
  "catalog",
  "customers",
  "supply",
  "advertising",
  "content",
  "reputation",
] as const;
export type AccountBrainDimension = (typeof ACCOUNT_BRAIN_DIMENSIONS)[number];

export type AccountBrainFinding = Readonly<{
  id: string;
  dimension: AccountBrainDimension;
  kind: string;
  title: string;
  summary: string;
  severity: "info" | "warning" | "critical";
  confidence: "low" | "medium" | "high";
  evidenceRefs: readonly string[];
  memoryRefs: readonly string[];
}>;

export type AccountBrainDimensionState = Readonly<{
  dimension: AccountBrainDimension;
  status: "healthy" | "attention" | "critical" | "insufficient-evidence";
  scoreBps: number | null;
  evidenceRefs: readonly string[];
  memoryRefs: readonly string[];
  missingInputs: readonly string[];
  findings: readonly AccountBrainFinding[];
}>;

export type AccountBrainSnapshot = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  generatedAt: string;
  asOf: string;
  complete: boolean;
  overallScoreBps: number | null;
  dimensions: readonly AccountBrainDimensionState[];
  strategicPriorities: readonly string[];
  evidenceRefs: readonly string[];
  memoryRefs: readonly string[];
  missingInputs: readonly string[];
  contentHash: string;
}>;

export function calculateAccountBrainScore(
  dimensions: readonly AccountBrainDimensionState[],
): number | null {
  const scored = dimensions.flatMap((dimension) =>
    dimension.scoreBps === null ? [] : [dimension.scoreBps],
  );
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((total, score) => total + score, 0) / scored.length);
}

export function deriveAccountBrainPriorities(
  dimensions: readonly AccountBrainDimensionState[],
): readonly string[] {
  const ranked = dimensions
    .filter((dimension) => dimension.status !== "healthy")
    .sort((left, right) => statusRank(right.status) - statusRank(left.status))
    .map((dimension) => `${dimension.dimension}:${dimension.status}`);
  return Object.freeze(ranked);
}

function statusRank(status: AccountBrainDimensionState["status"]): number {
  if (status === "critical") return 4;
  if (status === "attention") return 3;
  if (status === "insufficient-evidence") return 2;
  return 1;
}
