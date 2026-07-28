import { describe, expect, it } from "vitest";
import {
  evaluateSupplierStock,
  type SupplierStockInput,
  type SupplierStockPolicy,
} from "@eauto/domain";

const policy: SupplierStockPolicy = Object.freeze({
  recoveryStockThreshold: 2,
  recoveryConsecutiveSyncs: 2,
  costChangeAlertBps: 500,
  policyVersion: "supplier-stock-v1",
});

const baseInput: SupplierStockInput = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  listingId: "MLC123",
  supplierSourceId: "supplier-1",
  sourceType: "online",
  previousStock: 10,
  currentStock: 10,
  consecutiveSuccessfulSyncs: 1,
  syncSucceeded: true,
  listingStatus: "active",
  previousUnitCostMinor: 5_000,
  currentUnitCostMinor: 5_000,
  profitabilityStatus: "profitable",
  stockEvidence: Object.freeze({
    id: "stock-1",
    source: "supplier",
    observedAt: "2026-07-27T12:00:00.000Z",
    contentHash: "a".repeat(64),
  }),
  costEvidence: Object.freeze({
    id: "cost-1",
    source: "supplier",
    observedAt: "2026-07-27T12:00:00.000Z",
    contentHash: "b".repeat(64),
  }),
  asOf: "2026-07-27T13:00:00.000Z",
  maximumEvidenceAgeMs: 86_400_000,
});

describe("supplier stock domain", () => {
  it("proposes an approval-gated pause for fresh online zero stock", () => {
    const assessment = evaluateSupplierStock(
      { ...baseInput, previousStock: 3, currentStock: 0 },
      policy,
    );

    expect(assessment.availabilityProposal).toMatchObject({
      kind: "listing.pause",
      reason: "supplier-out-of-stock",
      requiresApproval: true,
    });
  });

  it.each(["manual", "own", "unverified"] as const)(
    "never autotoggles a %s stock source",
    (sourceType) => {
      const assessment = evaluateSupplierStock(
        { ...baseInput, sourceType, previousStock: 3, currentStock: 0 },
        policy,
      );

      expect(assessment.availabilityProposal).toBeNull();
    },
  );

  it("reactivates only after two recovery syncs and verified economics", () => {
    const assessment = evaluateSupplierStock(
      {
        ...baseInput,
        previousStock: 2,
        currentStock: 5,
        consecutiveSuccessfulSyncs: 2,
        listingStatus: "paused",
      },
      policy,
    );

    expect(assessment.availabilityProposal).toMatchObject({
      kind: "listing.reactivate",
      reason: "stock-recovered-and-margin-verified",
      requiresApproval: true,
    });
    expect(assessment.signals).toContainEqual(
      expect.objectContaining({ kind: "stock.recovered", severity: "info" }),
    );
  });

  it("blocks reactivation and requests a margin reaudit after a material cost increase", () => {
    const assessment = evaluateSupplierStock(
      {
        ...baseInput,
        previousStock: 2,
        currentStock: 5,
        consecutiveSuccessfulSyncs: 2,
        listingStatus: "paused",
        currentUnitCostMinor: 5_500,
      },
      policy,
    );

    expect(assessment.availabilityProposal).toBeNull();
    expect(assessment.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "cost.change", severity: "warning" }),
        expect.objectContaining({ kind: "margin.reaudit-required", severity: "warning" }),
      ]),
    );
  });

  it("does not trust stale stock evidence", () => {
    const assessment = evaluateSupplierStock(
      {
        ...baseInput,
        previousStock: 3,
        currentStock: 0,
        stockEvidence: {
          ...baseInput.stockEvidence,
          observedAt: "2026-07-20T12:00:00.000Z",
        },
      },
      policy,
    );

    expect(assessment.availabilityProposal).toBeNull();
    expect(assessment.signals).toContainEqual(
      expect.objectContaining({
        kind: "evidence.stale",
        severity: "critical",
        details: expect.objectContaining({ evidenceKind: "stock" }),
      }),
    );
  });

  it("reports sync failure without producing an availability proposal", () => {
    const assessment = evaluateSupplierStock(
      { ...baseInput, currentStock: 0, syncSucceeded: false },
      policy,
    );

    expect(assessment.availabilityProposal).toBeNull();
    expect(assessment.signals).toContainEqual(
      expect.objectContaining({ kind: "sync.failure", severity: "critical" }),
    );
  });
});
