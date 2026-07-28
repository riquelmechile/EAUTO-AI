export const PRODUCT_LIFECYCLE_STATES = [
  "active",
  "seasonal",
  "off-season",
  "obsolete-candidate",
  "insufficient-data",
  "uncertain",
] as const;
export type ProductLifecycleState = (typeof PRODUCT_LIFECYCLE_STATES)[number];

export type ProductLifecycleInput = Readonly<{
  organizationId: string;
  accountId: string;
  listingId: string;
  asOf: string;
  listingActive: boolean | null;
  availableQuantity: number | null;
  soldUnits30d: number | null;
  soldUnits90d: number | null;
  visits30d: number | null;
  lastSaleAt: string | null;
  marginBps: number | null;
  seasonInWindow: boolean | null;
  seasonEvidenceConfidence: "low" | "medium" | "high" | null;
  evidenceFresh: boolean;
  evidenceRefs: readonly string[];
}>;

export type ProductLifecycleAssessment = Readonly<{
  organizationId: string;
  accountId: string;
  listingId: string;
  state: ProductLifecycleState;
  confidence: "low" | "medium" | "high";
  reasons: readonly string[];
  evidenceRefs: readonly string[];
  missingInputs: readonly string[];
  assessedAt: string;
  contentHash: string;
}>;

export function classifyProductLifecycle(
  input: ProductLifecycleInput,
): Readonly<{
  state: ProductLifecycleState;
  confidence: "low" | "medium" | "high";
  reasons: readonly string[];
  missingInputs: readonly string[];
}> {
  const missingInputs = Object.freeze(
    [
      input.listingActive === null ? "listing-status" : null,
      input.availableQuantity === null ? "available-quantity" : null,
      input.soldUnits30d === null ? "sales-30d" : null,
      input.soldUnits90d === null ? "sales-90d" : null,
      input.marginBps === null ? "margin" : null,
    ].filter((value): value is string => value !== null),
  );
  if (!input.evidenceFresh) {
    return {
      state: "uncertain",
      confidence: "low",
      reasons: Object.freeze(["Operational evidence is stale."]),
      missingInputs,
    };
  }
  if (input.evidenceRefs.length === 0 || missingInputs.length > 0) {
    return {
      state: "insufficient-data",
      confidence: "low",
      reasons: Object.freeze(["Required lifecycle evidence is incomplete."]),
      missingInputs,
    };
  }
  if (
    input.seasonInWindow !== null &&
    input.seasonEvidenceConfidence !== null &&
    input.seasonEvidenceConfidence !== "low"
  ) {
    if (!input.seasonInWindow && input.soldUnits90d !== null && input.soldUnits90d > 0) {
      return {
        state: "off-season",
        confidence: input.seasonEvidenceConfidence,
        reasons: Object.freeze(["Verified season is outside the current observation window."]),
        missingInputs,
      };
    }
    if (input.seasonInWindow && input.soldUnits30d !== null && input.soldUnits30d > 0) {
      return {
        state: "seasonal",
        confidence: input.seasonEvidenceConfidence,
        reasons: Object.freeze(["Current sales align with a verified seasonal window."]),
        missingInputs,
      };
    }
  }
  const daysSinceSale = input.lastSaleAt
    ? Math.floor((Date.parse(input.asOf) - Date.parse(input.lastSaleAt)) / 86_400_000)
    : null;
  if (
    input.listingActive === false ||
    (input.soldUnits90d === 0 && input.visits30d !== null && input.visits30d < 5) ||
    (daysSinceSale !== null && daysSinceSale >= 180 && input.soldUnits90d === 0)
  ) {
    return {
      state: "obsolete-candidate",
      confidence: daysSinceSale !== null && daysSinceSale >= 180 ? "high" : "medium",
      reasons: Object.freeze([
        "No recent demand signal exists; manual review is required before retirement.",
      ]),
      missingInputs,
    };
  }
  if (input.soldUnits30d !== null && input.soldUnits30d > 0 && input.marginBps !== null) {
    return {
      state: "active",
      confidence: input.marginBps >= 0 ? "high" : "medium",
      reasons: Object.freeze(["Fresh sales and economic evidence indicate an active product."]),
      missingInputs,
    };
  }
  return {
    state: "uncertain",
    confidence: "low",
    reasons: Object.freeze(["Available signals do not support a stable lifecycle classification."]),
    missingInputs,
  };
}
