import { describe, expect, it } from "vitest";
import { SupplierStockService } from "@eauto/application";
import type {
  StockAvailabilityProposal,
  SupplierStockAssessment,
  SupplierStockInput,
  SupplierStockPolicy,
} from "@eauto/domain";

const policy: SupplierStockPolicy = Object.freeze({
  recoveryStockThreshold: 2,
  recoveryConsecutiveSyncs: 2,
  costChangeAlertBps: 500,
  policyVersion: "supplier-stock-v1",
});

const input: SupplierStockInput = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  listingId: "MLC123",
  supplierSourceId: "supplier-1",
  sourceType: "online",
  previousStock: 2,
  currentStock: 5,
  consecutiveSuccessfulSyncs: 2,
  syncSucceeded: true,
  listingStatus: "paused",
  previousUnitCostMinor: 5_000,
  currentUnitCostMinor: 5_500,
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

describe("SupplierStockService", () => {
  it("persists the assessment and schedules margin reaudit before reactivation", async () => {
    const assessments: SupplierStockAssessment[] = [];
    const proposals: StockAvailabilityProposal[] = [];
    const reaudits: string[] = [];
    const service = new SupplierStockService(
      { read: () => Promise.resolve(input) },
      {
        save: (assessment) => {
          assessments.push(assessment);
          return Promise.resolve();
        },
      },
      {
        save: (proposal) => {
          proposals.push(proposal);
          return Promise.resolve();
        },
      },
      {
        schedule: ({ reason }) => {
          reaudits.push(reason);
          return Promise.resolve();
        },
      },
    );

    const assessment = await service.evaluateListing(
      "plasticov",
      "MLC123",
      "supplier-1",
      policy,
    );

    expect(assessments).toHaveLength(1);
    expect(proposals).toHaveLength(0);
    expect(reaudits).toEqual(["supplier-cost-changed"]);
    expect(assessment.signals).toContainEqual(
      expect.objectContaining({ kind: "margin.reaudit-required" }),
    );
  });

  it("rejects a supplier adapter that crosses account scope", async () => {
    const service = new SupplierStockService(
      { read: () => Promise.resolve({ ...input, accountId: "maustian" }) },
      { save: () => Promise.resolve() },
      { save: () => Promise.resolve() },
      { schedule: () => Promise.resolve() },
    );

    await expect(
      service.evaluateListing("plasticov", "MLC123", "supplier-1", policy),
    ).rejects.toThrow(/outside the requested scope/);
  });
});
