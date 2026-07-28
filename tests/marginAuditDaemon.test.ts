import { describe, expect, it } from "vitest";
import {
  MarginAuditDaemon,
  ProfitEngineService,
  type MarginAuditCandidate,
  type MarginAuditFinding,
} from "@eauto/application";
import type { ProfitabilityInput, ProfitabilitySnapshot } from "@eauto/domain";

const candidate: MarginAuditCandidate = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  listingId: "MLC123",
});

const input: ProfitabilityInput = Object.freeze({
  accountId: "plasticov",
  listingId: "MLC123",
  currency: "CLP",
  salePriceMinor: 10_000,
  quantity: 1,
  variableRateBps: 1_600,
  variableRateEvidence: Object.freeze({
    id: "fee",
    source: "mercadolibre",
    observedAt: "2026-07-27T12:00:00.000Z",
    contentHash: "a".repeat(64),
  }),
  costs: Object.freeze([
    Object.freeze({
      kind: "product-cost" as const,
      amountMinor: 7_000,
      evidence: Object.freeze({
        id: "product",
        source: "supplier",
        observedAt: "2026-07-27T12:00:00.000Z",
        contentHash: "b".repeat(64),
      }),
    }),
    Object.freeze({
      kind: "fulfillment-cost" as const,
      amountMinor: 2_000,
      evidence: Object.freeze({
        id: "fulfillment",
        source: "mercadolibre",
        observedAt: "2026-07-27T12:00:00.000Z",
        contentHash: "c".repeat(64),
      }),
    }),
  ]),
  minimumMarginBps: 3_000,
  asOf: "2026-07-27T13:00:00.000Z",
  maximumEvidenceAgeMs: 86_400_000,
});

describe("MarginAuditDaemon", () => {
  it("leases, audits and records a critical loss finding", async () => {
    const snapshots: ProfitabilitySnapshot[] = [];
    const findings: MarginAuditFinding[] = [];
    const completed: string[] = [];
    const profitEngine = new ProfitEngineService(
      { read: () => Promise.resolve(input) },
      {
        save: (snapshot) => {
          snapshots.push(snapshot);
          return Promise.resolve();
        },
      },
      { save: () => Promise.resolve() },
    );
    const daemon = new MarginAuditDaemon(
      profitEngine,
      {
        claim: () => Promise.resolve([candidate]),
        complete: ({ candidate: leased }) => {
          completed.push(leased.listingId);
          return Promise.resolve();
        },
        fail: () => Promise.reject(new Error("failure path was not expected")),
      },
      {
        save: (finding) => {
          findings.push(finding);
          return Promise.resolve();
        },
      },
      {
        workerId: "margin-test",
        leaseMs: 30_000,
        successIntervalMs: 900_000,
        retryIntervalMs: 60_000,
        now: () => new Date("2026-07-27T13:00:00.000Z"),
      },
    );

    const result = await daemon.runOnce(10);

    expect(result).toEqual({ leased: 1, audited: 1, findings: 1, failed: 0 });
    expect(snapshots).toHaveLength(1);
    expect(findings[0]).toMatchObject({ status: "loss", severity: "critical" });
    expect(completed).toEqual(["MLC123"]);
  });

  it("releases a failed audit for deterministic retry", async () => {
    const failures: string[] = [];
    const profitEngine = new ProfitEngineService(
      { read: () => Promise.reject(new Error("economic source unavailable")) },
      { save: () => Promise.resolve() },
      { save: () => Promise.resolve() },
    );
    const daemon = new MarginAuditDaemon(
      profitEngine,
      {
        claim: () => Promise.resolve([candidate]),
        complete: () => Promise.reject(new Error("completion was not expected")),
        fail: ({ error }) => {
          failures.push(error);
          return Promise.resolve();
        },
      },
      { save: () => Promise.resolve() },
      {
        workerId: "margin-test",
        leaseMs: 30_000,
        successIntervalMs: 900_000,
        retryIntervalMs: 60_000,
        now: () => new Date("2026-07-27T13:00:00.000Z"),
      },
    );

    const result = await daemon.runOnce(10);

    expect(result).toEqual({ leased: 1, audited: 0, findings: 0, failed: 1 });
    expect(failures).toEqual(["economic source unavailable"]);
  });
});
