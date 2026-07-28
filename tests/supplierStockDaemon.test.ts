import { describe, expect, it } from "vitest";
import {
  SupplierStockDaemon,
  SupplierStockService,
  type SupplierStockCandidate,
} from "@eauto/application";
import type { SupplierStockInput } from "@eauto/domain";

const candidate: SupplierStockCandidate = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  listingId: "MLC123",
  policy: Object.freeze({
    recoveryStockThreshold: 2,
    recoveryConsecutiveSyncs: 2,
    costChangeAlertBps: 500,
    policyVersion: "supplier-stock-v1",
  }),
});

const input: SupplierStockInput = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  listingId: "MLC123",
  supplierSourceId: "supplier-1",
  sourceType: "online",
  previousStock: 3,
  currentStock: 0,
  consecutiveSuccessfulSyncs: 0,
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

describe("SupplierStockDaemon", () => {
  it("evaluates a leased candidate and completes it", async () => {
    const completed: string[] = [];
    const proposals: string[] = [];
    const service = new SupplierStockService(
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
    const daemon = new SupplierStockDaemon(
      service,
      {
        claim: () => Promise.resolve([candidate]),
        complete: ({ candidate: leased }) => {
          completed.push(leased.listingId);
          return Promise.resolve();
        },
        fail: () => Promise.reject(new Error("fail must not be called")),
      },
      {
        workerId: "stock-worker-1",
        leaseMs: 30_000,
        successIntervalMs: 900_000,
        retryIntervalMs: 60_000,
        now: () => new Date("2026-07-27T13:00:00.000Z"),
      },
    );

    await expect(daemon.runOnce(10)).resolves.toEqual({
      leased: 1,
      evaluated: 1,
      proposals: 1,
      reaudits: 0,
      failed: 0,
    });
    expect(completed).toEqual(["MLC123"]);
    expect(proposals).toEqual(["listing.pause"]);
  });

  it("releases a failed candidate with a bounded retry", async () => {
    const failures: string[] = [];
    const service = new SupplierStockService(
      { read: () => Promise.reject(new Error("supplier mirror unavailable\nsecret-detail")) },
      { save: () => Promise.resolve() },
      { save: () => Promise.resolve() },
      { schedule: () => Promise.resolve() },
    );
    const daemon = new SupplierStockDaemon(
      service,
      {
        claim: () => Promise.resolve([candidate]),
        complete: () => Promise.reject(new Error("complete must not be called")),
        fail: ({ error }) => {
          failures.push(error);
          return Promise.resolve();
        },
      },
      {
        workerId: "stock-worker-1",
        leaseMs: 30_000,
        successIntervalMs: 900_000,
        retryIntervalMs: 60_000,
        now: () => new Date("2026-07-27T13:00:00.000Z"),
      },
    );

    await expect(daemon.runOnce(1)).resolves.toEqual({
      leased: 1,
      evaluated: 0,
      proposals: 0,
      reaudits: 0,
      failed: 1,
    });
    expect(failures).toEqual(["supplier mirror unavailable secret-detail"]);
  });
});
