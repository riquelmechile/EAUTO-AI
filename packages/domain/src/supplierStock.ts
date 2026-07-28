export const STOCK_SOURCE_TYPES = ["online", "manual", "own", "unverified"] as const;
export type StockSourceType = (typeof STOCK_SOURCE_TYPES)[number];

export type SupplierStockEvidence = Readonly<{
  id: string;
  source: string;
  observedAt: string;
  contentHash: string;
}>;

export type SupplierStockInput = Readonly<{
  organizationId: string;
  accountId: string;
  listingId: string;
  supplierSourceId: string;
  sourceType: StockSourceType;
  previousStock: number;
  currentStock: number;
  consecutiveSuccessfulSyncs: number;
  syncSucceeded: boolean;
  listingStatus: "active" | "paused";
  previousUnitCostMinor: number | null;
  currentUnitCostMinor: number | null;
  profitabilityStatus: "profitable" | "below-floor" | "loss" | "incomplete" | "unknown";
  stockEvidence: SupplierStockEvidence;
  costEvidence: SupplierStockEvidence | null;
  asOf: string;
  maximumEvidenceAgeMs: number;
}>;

export type SupplierStockPolicy = Readonly<{
  recoveryStockThreshold: number;
  recoveryConsecutiveSyncs: number;
  costChangeAlertBps: number;
  policyVersion: string;
}>;

export type StockAvailabilityProposal = Readonly<{
  kind: "listing.pause" | "listing.reactivate";
  organizationId: string;
  accountId: string;
  listingId: string;
  supplierSourceId: string;
  reason: "supplier-out-of-stock" | "stock-recovered-and-margin-verified";
  evidenceRefs: readonly string[];
  policyVersion: string;
  requiresApproval: true;
}>;

export type SupplierStockSignal = Readonly<{
  kind:
    | "sync.failure"
    | "stock.recovered"
    | "cost.change"
    | "margin.reaudit-required"
    | "evidence.stale";
  severity: "info" | "warning" | "critical";
  details: Readonly<Record<string, string | number | boolean>>;
}>;

export type SupplierStockAssessment = Readonly<{
  organizationId: string;
  accountId: string;
  listingId: string;
  supplierSourceId: string;
  sourceType: StockSourceType;
  policyVersion: string;
  stockDelta: number;
  evidenceRefs: readonly string[];
  availabilityProposal: StockAvailabilityProposal | null;
  signals: readonly SupplierStockSignal[];
  evaluatedAt: string;
}>;

export function evaluateSupplierStock(
  input: SupplierStockInput,
  policy: SupplierStockPolicy,
): SupplierStockAssessment {
  assertNonNegativeInteger(input.previousStock, "previousStock");
  assertNonNegativeInteger(input.currentStock, "currentStock");
  assertNonNegativeInteger(input.consecutiveSuccessfulSyncs, "consecutiveSuccessfulSyncs");
  assertNonNegativeInteger(policy.recoveryStockThreshold, "recoveryStockThreshold");
  assertPositiveInteger(policy.recoveryConsecutiveSyncs, "recoveryConsecutiveSyncs");
  assertBasisPoints(policy.costChangeAlertBps, "costChangeAlertBps");
  if (!Number.isSafeInteger(input.maximumEvidenceAgeMs) || input.maximumEvidenceAgeMs < 0) {
    throw new Error("maximumEvidenceAgeMs must be a non-negative safe integer.");
  }
  if (!policy.policyVersion.trim()) throw new Error("policyVersion is required.");

  const asOf = parseDate(input.asOf, "asOf");
  const stockEvidenceFresh = !isStale(input.stockEvidence, asOf, input.maximumEvidenceAgeMs);
  const costEvidenceFresh =
    input.costEvidence === null || !isStale(input.costEvidence, asOf, input.maximumEvidenceAgeMs);
  const evidenceRefs = Object.freeze(
    [input.stockEvidence.id, ...(input.costEvidence ? [input.costEvidence.id] : [])].sort(),
  );
  const signals: SupplierStockSignal[] = [];

  if (!stockEvidenceFresh) {
    signals.push(
      signal("evidence.stale", "critical", {
        evidenceKind: "stock",
        evidenceId: input.stockEvidence.id,
      }),
    );
  }
  if (!costEvidenceFresh && input.costEvidence) {
    signals.push(
      signal("evidence.stale", "warning", {
        evidenceKind: "cost",
        evidenceId: input.costEvidence.id,
      }),
    );
  }
  if (!input.syncSucceeded) {
    signals.push(
      signal("sync.failure", "critical", {
        supplierSourceId: input.supplierSourceId,
        sourceType: input.sourceType,
      }),
    );
  }

  const costChangeBps = calculateCostChangeBps(
    input.previousUnitCostMinor,
    input.currentUnitCostMinor,
  );
  if (costChangeBps !== null && Math.abs(costChangeBps) >= policy.costChangeAlertBps) {
    signals.push(
      signal("cost.change", costChangeBps > 0 ? "warning" : "info", {
        changeBps: costChangeBps,
        previousUnitCostMinor: input.previousUnitCostMinor as number,
        currentUnitCostMinor: input.currentUnitCostMinor as number,
      }),
    );
    signals.push(
      signal("margin.reaudit-required", "warning", {
        reason: "supplier-cost-changed",
        changeBps: costChangeBps,
      }),
    );
  }

  let availabilityProposal: StockAvailabilityProposal | null = null;
  const automaticSourceEligible = input.sourceType === "online";

  if (
    automaticSourceEligible &&
    input.syncSucceeded &&
    stockEvidenceFresh &&
    input.currentStock === 0 &&
    input.listingStatus === "active"
  ) {
    availabilityProposal = proposal(
      input,
      policy,
      "listing.pause",
      "supplier-out-of-stock",
      evidenceRefs,
    );
  }

  const stockRecovered =
    input.previousStock <= policy.recoveryStockThreshold &&
    input.currentStock > policy.recoveryStockThreshold;
  if (automaticSourceEligible && input.syncSucceeded && stockEvidenceFresh && stockRecovered) {
    signals.push(
      signal("stock.recovered", "info", {
        currentStock: input.currentStock,
        consecutiveSuccessfulSyncs: input.consecutiveSuccessfulSyncs,
      }),
    );
  }

  const recoveryConfirmed =
    input.currentStock > policy.recoveryStockThreshold &&
    input.consecutiveSuccessfulSyncs >= policy.recoveryConsecutiveSyncs &&
    input.listingStatus === "paused";
  if (automaticSourceEligible && input.syncSucceeded && stockEvidenceFresh && recoveryConfirmed) {
    if (input.profitabilityStatus === "profitable" && costEvidenceFresh && costChangeBps === 0) {
      availabilityProposal = proposal(
        input,
        policy,
        "listing.reactivate",
        "stock-recovered-and-margin-verified",
        evidenceRefs,
      );
    } else if (!signals.some((candidate) => candidate.kind === "margin.reaudit-required")) {
      signals.push(
        signal("margin.reaudit-required", "warning", {
          reason: "stock-recovered-without-verified-margin",
          profitabilityStatus: input.profitabilityStatus,
        }),
      );
    }
  }

  return Object.freeze({
    organizationId: input.organizationId,
    accountId: input.accountId,
    listingId: input.listingId,
    supplierSourceId: input.supplierSourceId,
    sourceType: input.sourceType,
    policyVersion: policy.policyVersion,
    stockDelta: input.currentStock - input.previousStock,
    evidenceRefs,
    availabilityProposal,
    signals: Object.freeze(signals),
    evaluatedAt: input.asOf,
  });
}

function proposal(
  input: SupplierStockInput,
  policy: SupplierStockPolicy,
  kind: StockAvailabilityProposal["kind"],
  reason: StockAvailabilityProposal["reason"],
  evidenceRefs: readonly string[],
): StockAvailabilityProposal {
  return Object.freeze({
    kind,
    organizationId: input.organizationId,
    accountId: input.accountId,
    listingId: input.listingId,
    supplierSourceId: input.supplierSourceId,
    reason,
    evidenceRefs,
    policyVersion: policy.policyVersion,
    requiresApproval: true,
  });
}

function signal(
  kind: SupplierStockSignal["kind"],
  severity: SupplierStockSignal["severity"],
  details: SupplierStockSignal["details"],
): SupplierStockSignal {
  return Object.freeze({ kind, severity, details: Object.freeze({ ...details }) });
}

function calculateCostChangeBps(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null) return null;
  assertPositiveInteger(previous, "previousUnitCostMinor");
  assertNonNegativeInteger(current, "currentUnitCostMinor");
  const numerator = (current - previous) * 10_000;
  if (!Number.isSafeInteger(numerator)) {
    throw new Error("Supplier cost change exceeded safe integer range.");
  }
  return Math.trunc(numerator / previous);
}

function isStale(
  evidence: SupplierStockEvidence,
  asOf: Date,
  maximumEvidenceAgeMs: number,
): boolean {
  const observedAt = parseDate(evidence.observedAt, `evidence:${evidence.id}:observedAt`);
  const age = asOf.getTime() - observedAt.getTime();
  return age < 0 || age > maximumEvidenceAgeMs;
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date.`);
  return parsed;
}

function assertBasisPoints(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field} must be an integer between 0 and 10000 basis points.`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}
