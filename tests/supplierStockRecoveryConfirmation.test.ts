import { describe, expect, it } from "vitest";
import { evaluateSupplierStock, type SupplierStockInput } from "@eauto/domain";

const baseInput: SupplierStockInput = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  listingId: "MLC123",
  supplierSourceId: "supplier-1",
  sourceType: "online",
  previousStock: 5,
  currentStock: 5,
  consecutiveSuccessfulSyncs: 2,
  syncSucceeded: true,
  listingStatus: "paused",
  previousUnitCostMinor: 5_000,
  currentUnitCostMinor: 5_000,
  profitabilityStatus: "profitable",
  stockEvidence: Object.freeze({
    id: "stock-confirmation-2",
    source: "supplier",
    observedAt: "2026-07-27T13:00:00.000Z",
    contentHash: "a".repeat(64),
  }),
  costEvidence: Object.freeze({
    id: "cost-confirmation-2",
    source: "supplier",
    observedAt: "2026-07-27T13:00:00.000Z",
    contentHash: "b".repeat(64),
  }),
  asOf: "2026-07-27T13:05:00.000Z",
  maximumEvidenceAgeMs: 86_400_000,
});

const policy = Object.freeze({
  recoveryStockThreshold: 2,
  recoveryConsecutiveSyncs: 2,
  costChangeAlertBps: 500,
  policyVersion: "supplier-stock-v1",
});

describe("supplier recovery confirmation", () => {
  it("allows a governed reactivation on the second confirmed sync above threshold", () => {
    const assessment = evaluateSupplierStock(baseInput, policy);

    expect(assessment.availabilityProposal).toMatchObject({
      kind: "listing.reactivate",
      reason: "stock-recovered-and-margin-verified",
      requiresApproval: true,
    });
  });

  it("does not reactivate after only one post-outage confirmation", () => {
    const assessment = evaluateSupplierStock(
      { ...baseInput, previousStock: 0, consecutiveSuccessfulSyncs: 1 },
      policy,
    );

    expect(assessment.availabilityProposal).toBeNull();
    expect(assessment.signals).toContainEqual(
      expect.objectContaining({ kind: "stock.recovered", severity: "info" }),
    );
  });
});
