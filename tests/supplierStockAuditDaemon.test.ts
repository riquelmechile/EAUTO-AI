import { describe, expect, it } from "vitest";
import {
  SupplierStockAuditDaemon,
  SupplierStockService,
  type SupplierStockAuditCandidate,
} from "@eauto/application";
import type { SupplierStockInput } from "@eauto/domain";

const candidate: SupplierStockAuditCandidate = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  listingId: "MLC123",
  supplierSourceId: "supplier-1",
  policy: Object.freeze({
    recoveryStockThreshold: 2,
    recoveryConsecutiveSyncs: 2,
    costChangeAlertBps: 500,
    policyVersion: "supplier-stock-v1",
  }),
});

const input: SupplierStockInput = Object.freeze({
  organizationId: candidate.organizationId,
  accountId: candidate.accountId,
  listingId: candidate.listingId,
  supplierSourceId: candidate.supplierSourceId,
  sourceType: "online",
  previousStock: 3,
  currentStock: 0,
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

describe("SupplierStockAuditDaemon", () => {
  it("leases, evaluates and completes an approval-gated pause proposal", async () => {
    const completed: string[] = [];
    const proposals: string[] = [];
    const stockService = new SupplierStockService(
      { read: () => Promise.resolve(input) },
      { save: () => Promise.resolve() },
      {
        save: (proposal) => {
          proposals.push(proposal.kind);
          return Promise.resolve();
        },
      },
      { schedule: () => Promise.resolve() },
    );
    const daemon = new SupplierStockAuditDaemon(
      stockService,
      {
        claim: () => Promise.resolve([candidate]),
        complete: ({ candidate: leased }) => {
          completed.push(leased.listingId);
          return Promise.resolve();
        },
        fail: () => Promise.reject(new Error("failure path was not expected")),
      },
      {
        workerId: "supplier-stock-test",
        leaseMs: 30_000,
        successIntervalMs: 900_000,
        retryIntervalMs: 60_000,
        now: () => new Date("2026-07-27T13:00:00.000Z"),
      },
    );

    const result = await daemon.runOnce(10);

    expect(result).toEqual({ leased: 1, evaluated: 1, proposals: 1, failed: 0 });
    expect(proposals).toEqual(["listing.pause"]);
    expect(completed).toEqual(["MLC123"]);
  });

  it("releases a failed evaluation for deterministic retry", async () => {
    const failures: string[] = [];
    const stockService = new SupplierStockService(
      { read: () => Promise.reject(new Error("supplier mirror unavailable")) },
      { save: () => Promise.resolve() },
      { save: () => Promise.resolve() },
      { schedule: () => Promise.resolve() },
    );
    const daemon = new SupplierStockAuditDaemon(
      stockService,
      {
        claim: () => Promise.resolve([candidate]),
        complete: () => Promise.reject(new Error("completion was not expected")),
        fail: ({ error }) => {
          failures.push(error);
          return Promise.resolve();
        },
      },
      {
        workerId: "supplier-stock-test",
        leaseMs: 30_000,
        successIntervalMs: 900_000,
        retryIntervalMs: 60_000,
        now: () => new Date("2026-07-27T13:00:00.000Z"),
      },
    );

    const result = await daemon.runOnce(10);

    expect(result).toEqual({ leased: 1, evaluated: 0, proposals: 0, failed: 1 });
    expect(failures).toEqual(["supplier mirror unavailable"]);
  });
});
