import type { StockSourceType, SupplierStockEvidence } from "./supplierStock.js";

export type SupplierProductObservation = Readonly<{
  organizationId: string;
  accountId: string;
  supplierSourceId: string;
  sourceType: StockSourceType;
  sku: string;
  name: string;
  stockQuantity: number;
  unitCostMinor: number | null;
  syncSucceeded: boolean;
  observedAt: string;
  evidence: SupplierStockEvidence;
}>;

export type RecordedSupplierProduct = Readonly<{
  organizationId: string;
  accountId: string;
  supplierSourceId: string;
  sourceType: StockSourceType;
  sku: string;
  name: string;
  previousStock: number;
  currentStock: number;
  previousUnitCostMinor: number | null;
  currentUnitCostMinor: number | null;
  consecutiveSuccessfulSyncs: number;
  syncSucceeded: boolean;
  observedAt: string;
  evidence: SupplierStockEvidence;
}>;

export function validateSupplierProductObservation(
  observation: SupplierProductObservation,
): SupplierProductObservation {
  for (const [field, value] of [
    ["organizationId", observation.organizationId],
    ["accountId", observation.accountId],
    ["supplierSourceId", observation.supplierSourceId],
    ["sku", observation.sku],
    ["name", observation.name],
    ["evidence.id", observation.evidence.id],
    ["evidence.source", observation.evidence.source],
    ["evidence.contentHash", observation.evidence.contentHash],
  ] as const) {
    if (!value.trim()) throw new Error(`${field} is required.`);
  }
  assertNonNegativeSafeInteger(observation.stockQuantity, "stockQuantity");
  if (observation.unitCostMinor !== null) {
    assertNonNegativeSafeInteger(observation.unitCostMinor, "unitCostMinor");
  }
  const observedAt = new Date(observation.observedAt);
  const evidenceObservedAt = new Date(observation.evidence.observedAt);
  if (Number.isNaN(observedAt.getTime())) throw new Error("observedAt must be an ISO date.");
  if (Number.isNaN(evidenceObservedAt.getTime())) {
    throw new Error("evidence.observedAt must be an ISO date.");
  }
  if (observation.observedAt !== observation.evidence.observedAt) {
    throw new Error("Supplier observation and evidence timestamps must match.");
  }
  return Object.freeze({
    ...observation,
    evidence: Object.freeze({ ...observation.evidence }),
  });
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}
