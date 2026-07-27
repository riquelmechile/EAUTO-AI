export const ECONOMIC_COST_KINDS = [
  "product-cost",
  "fulfillment-cost",
  "packaging-cost",
  "ads-cost",
  "returns-cost",
  "discount-cost",
  "import-cost",
  "other-cost",
] as const;

export type EconomicCostKind = (typeof ECONOMIC_COST_KINDS)[number];
export type ProfitabilityStatus = "profitable" | "below-floor" | "loss";

export type EconomicEvidenceReference = Readonly<{
  id: string;
  source: string;
  observedAt: string;
  contentHash: string;
}>;

export type EconomicCostComponent = Readonly<{
  kind: EconomicCostKind;
  amountMinor: number;
  evidence: EconomicEvidenceReference;
}>;

export type ProfitabilityInput = Readonly<{
  accountId: string;
  listingId: string;
  currency: "CLP";
  salePriceMinor: number;
  quantity: number;
  variableRateBps: number | null;
  variableRateEvidence: EconomicEvidenceReference | null;
  costs: readonly EconomicCostComponent[];
  minimumMarginBps: number;
  asOf: string;
  maximumEvidenceAgeMs: number;
}>;

export type IncompleteProfitabilitySnapshot = Readonly<{
  status: "incomplete";
  accountId: string;
  listingId: string;
  currency: "CLP";
  salePriceMinor: number;
  quantity: number;
  minimumMarginBps: number;
  missingInputs: readonly string[];
  staleEvidenceIds: readonly string[];
  evidenceRefs: readonly string[];
}>;

export type CompleteProfitabilitySnapshot = Readonly<{
  status: ProfitabilityStatus;
  accountId: string;
  listingId: string;
  currency: "CLP";
  salePriceMinor: number;
  quantity: number;
  minimumMarginBps: number;
  variableRateBps: number;
  grossRevenueMinor: number;
  fixedCostsMinor: number;
  variableCostsMinor: number;
  totalCostsMinor: number;
  netProfitMinor: number;
  marginBps: number;
  evidenceRefs: readonly string[];
  calculatedAt: string;
}>;

export type ProfitabilitySnapshot = IncompleteProfitabilitySnapshot | CompleteProfitabilitySnapshot;

export type RepricingPolicy = Readonly<{
  targetMarginBps: number;
  maximumIncreaseBps: number;
  competitiveCeilingMinor?: number;
  policyVersion: string;
}>;

export type RepricingProposal = Readonly<{
  status: "proposed";
  accountId: string;
  listingId: string;
  currency: "CLP";
  currentPriceMinor: number;
  proposedPriceMinor: number;
  currentMarginBps: number;
  projectedMarginBps: number;
  targetMarginBps: number;
  evidenceRefs: readonly string[];
  policyVersion: string;
  requiresApproval: true;
}>;

export type RepricingDecision =
  | RepricingProposal
  | Readonly<{
      status: "no-change";
      reason: "margin-at-or-above-target";
      currentMarginBps: number;
      targetMarginBps: number;
    }>
  | Readonly<{
      status: "blocked";
      reason:
        | "incomplete-economics"
        | "invalid-policy"
        | "maximum-increase-exceeded"
        | "competitive-ceiling-exceeded";
      missingInputs?: readonly string[];
      requiredPriceMinor?: number;
    }>;

const REQUIRED_COST_KINDS: readonly EconomicCostKind[] = ["product-cost", "fulfillment-cost"];

export function calculateProfitability(input: ProfitabilityInput): ProfitabilitySnapshot {
  assertSafePositiveInteger(input.salePriceMinor, "salePriceMinor");
  assertSafePositiveInteger(input.quantity, "quantity");
  assertBasisPoints(input.minimumMarginBps, "minimumMarginBps");
  if (!Number.isSafeInteger(input.maximumEvidenceAgeMs) || input.maximumEvidenceAgeMs < 0) {
    throw new Error("maximumEvidenceAgeMs must be a non-negative safe integer.");
  }

  const asOf = parseDate(input.asOf, "asOf");
  const missingInputs: string[] = [];
  const staleEvidenceIds: string[] = [];
  const evidenceRefs: string[] = [];

  if (input.variableRateBps === null || input.variableRateEvidence === null) {
    missingInputs.push("marketplace-fee-rate");
  } else {
    assertBasisPoints(input.variableRateBps, "variableRateBps");
    evidenceRefs.push(input.variableRateEvidence.id);
    if (isStale(input.variableRateEvidence, asOf, input.maximumEvidenceAgeMs)) {
      staleEvidenceIds.push(input.variableRateEvidence.id);
    }
  }

  for (const requiredKind of REQUIRED_COST_KINDS) {
    if (!input.costs.some((cost) => cost.kind === requiredKind)) missingInputs.push(requiredKind);
  }

  for (const cost of input.costs) {
    if (!Number.isSafeInteger(cost.amountMinor) || cost.amountMinor < 0) {
      throw new Error(`Cost ${cost.kind} must use non-negative safe integer minor units.`);
    }
    evidenceRefs.push(cost.evidence.id);
    if (isStale(cost.evidence, asOf, input.maximumEvidenceAgeMs)) {
      staleEvidenceIds.push(cost.evidence.id);
    }
  }

  if (missingInputs.length > 0 || staleEvidenceIds.length > 0) {
    return Object.freeze({
      status: "incomplete",
      accountId: input.accountId,
      listingId: input.listingId,
      currency: input.currency,
      salePriceMinor: input.salePriceMinor,
      quantity: input.quantity,
      minimumMarginBps: input.minimumMarginBps,
      missingInputs: Object.freeze([...new Set(missingInputs)].sort()),
      staleEvidenceIds: Object.freeze([...new Set(staleEvidenceIds)].sort()),
      evidenceRefs: Object.freeze([...new Set(evidenceRefs)].sort()),
    });
  }

  const variableRateBps = input.variableRateBps as number;
  const grossRevenueMinor = safeMultiply(input.salePriceMinor, input.quantity);
  const fixedCostsMinor = input.costs.reduce(
    (total, cost) => safeAdd(total, safeMultiply(cost.amountMinor, input.quantity)),
    0,
  );
  const variableCostsMinor = Math.round((grossRevenueMinor * variableRateBps) / 10_000);
  const totalCostsMinor = safeAdd(fixedCostsMinor, variableCostsMinor);
  const netProfitMinor = grossRevenueMinor - totalCostsMinor;
  const marginBps = Math.trunc((netProfitMinor * 10_000) / grossRevenueMinor);
  const status: ProfitabilityStatus =
    netProfitMinor < 0 ? "loss" : marginBps < input.minimumMarginBps ? "below-floor" : "profitable";

  return Object.freeze({
    status,
    accountId: input.accountId,
    listingId: input.listingId,
    currency: input.currency,
    salePriceMinor: input.salePriceMinor,
    quantity: input.quantity,
    minimumMarginBps: input.minimumMarginBps,
    variableRateBps,
    grossRevenueMinor,
    fixedCostsMinor,
    variableCostsMinor,
    totalCostsMinor,
    netProfitMinor,
    marginBps,
    evidenceRefs: Object.freeze([...new Set(evidenceRefs)].sort()),
    calculatedAt: input.asOf,
  });
}

export function prepareRepricingProposal(
  snapshot: ProfitabilitySnapshot,
  policy: RepricingPolicy,
): RepricingDecision {
  if (snapshot.status === "incomplete") {
    return Object.freeze({
      status: "blocked",
      reason: "incomplete-economics",
      missingInputs: Object.freeze([
        ...snapshot.missingInputs,
        ...snapshot.staleEvidenceIds.map((id) => `stale-evidence:${id}`),
      ]),
    });
  }

  assertBasisPoints(policy.targetMarginBps, "targetMarginBps");
  assertBasisPoints(policy.maximumIncreaseBps, "maximumIncreaseBps");
  if (snapshot.variableRateBps + policy.targetMarginBps >= 10_000) {
    return Object.freeze({ status: "blocked", reason: "invalid-policy" });
  }
  if (snapshot.marginBps >= policy.targetMarginBps) {
    return Object.freeze({
      status: "no-change",
      reason: "margin-at-or-above-target",
      currentMarginBps: snapshot.marginBps,
      targetMarginBps: policy.targetMarginBps,
    });
  }

  const perUnitFixedCostsMinor = Math.ceil(snapshot.fixedCostsMinor / snapshot.quantity);
  const denominatorBps = 10_000 - snapshot.variableRateBps - policy.targetMarginBps;
  const requiredPriceMinor = Math.ceil((perUnitFixedCostsMinor * 10_000) / denominatorBps);
  const maximumAllowedPriceMinor = Math.floor(
    (snapshot.salePriceMinor * (10_000 + policy.maximumIncreaseBps)) / 10_000,
  );

  if (requiredPriceMinor > maximumAllowedPriceMinor) {
    return Object.freeze({
      status: "blocked",
      reason: "maximum-increase-exceeded",
      requiredPriceMinor,
    });
  }
  if (
    policy.competitiveCeilingMinor !== undefined &&
    requiredPriceMinor > policy.competitiveCeilingMinor
  ) {
    return Object.freeze({
      status: "blocked",
      reason: "competitive-ceiling-exceeded",
      requiredPriceMinor,
    });
  }

  const projectedVariableCostsMinor = Math.round(
    (requiredPriceMinor * snapshot.variableRateBps) / 10_000,
  );
  const projectedProfitMinor =
    requiredPriceMinor - perUnitFixedCostsMinor - projectedVariableCostsMinor;
  const projectedMarginBps = Math.trunc((projectedProfitMinor * 10_000) / requiredPriceMinor);

  return Object.freeze({
    status: "proposed",
    accountId: snapshot.accountId,
    listingId: snapshot.listingId,
    currency: snapshot.currency,
    currentPriceMinor: snapshot.salePriceMinor,
    proposedPriceMinor: requiredPriceMinor,
    currentMarginBps: snapshot.marginBps,
    projectedMarginBps,
    targetMarginBps: policy.targetMarginBps,
    evidenceRefs: snapshot.evidenceRefs,
    policyVersion: policy.policyVersion,
    requiresApproval: true,
  });
}

function assertSafePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
}

function assertBasisPoints(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field} must be an integer between 0 and 10000 basis points.`);
  }
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be an ISO date.`);
  return date;
}

function isStale(
  evidence: EconomicEvidenceReference,
  asOf: Date,
  maximumEvidenceAgeMs: number,
): boolean {
  const observedAt = parseDate(evidence.observedAt, `evidence:${evidence.id}:observedAt`);
  const age = asOf.getTime() - observedAt.getTime();
  return age < 0 || age > maximumEvidenceAgeMs;
}

function safeMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result))
    throw new Error("Economic calculation exceeded safe integer range.");
  return result;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result))
    throw new Error("Economic calculation exceeded safe integer range.");
  return result;
}
