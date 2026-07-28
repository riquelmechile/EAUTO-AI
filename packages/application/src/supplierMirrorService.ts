import type { StockSourceType, SupplierStockEvidence } from "@eauto/domain";

export type SupplierMirrorObservation = Readonly<{
  organizationId: string;
  accountId: string;
  listingId: string;
  supplierSourceId: string;
  sourceType: StockSourceType;
  stockQuantity: number;
  unitCostMinor: number | null;
  syncSucceeded: boolean;
  stockEvidence: SupplierStockEvidence;
  costEvidence: SupplierStockEvidence | null;
}>;

export type ForRecordingSupplierMirrorObservations = {
  record(observation: SupplierMirrorObservation): Promise<"recorded" | "duplicate">;
};

export class SupplierMirrorService {
  constructor(private readonly observations: ForRecordingSupplierMirrorObservations) {}

  async recordObservation(
    observation: SupplierMirrorObservation,
  ): Promise<"recorded" | "duplicate"> {
    requireIdentifier(observation.organizationId, "organizationId");
    requireIdentifier(observation.accountId, "accountId");
    requireIdentifier(observation.listingId, "listingId");
    requireIdentifier(observation.supplierSourceId, "supplierSourceId");
    requireEvidence(observation.stockEvidence, "stockEvidence");
    if (observation.costEvidence) requireEvidence(observation.costEvidence, "costEvidence");
    assertNonNegativeInteger(observation.stockQuantity, "stockQuantity");
    if (observation.unitCostMinor !== null) {
      assertNonNegativeInteger(observation.unitCostMinor, "unitCostMinor");
      if (!observation.costEvidence) {
        throw new Error("costEvidence is required when unitCostMinor is provided.");
      }
    }
    if (observation.unitCostMinor === null && observation.costEvidence !== null) {
      throw new Error("costEvidence requires unitCostMinor.");
    }
    return this.observations.record(Object.freeze({ ...observation }));
  }
}

function requireIdentifier(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}

function requireEvidence(evidence: SupplierStockEvidence, field: string): void {
  requireIdentifier(evidence.id, `${field}.id`);
  requireIdentifier(evidence.source, `${field}.source`);
  requireIdentifier(evidence.contentHash, `${field}.contentHash`);
  if (Number.isNaN(new Date(evidence.observedAt).getTime())) {
    throw new Error(`${field}.observedAt must be an ISO date.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}
