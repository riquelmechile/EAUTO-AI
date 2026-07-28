import { describe, expect, it } from "vitest";
import {
  AccountBrainService,
  ProductLifecycleService,
  SupplyWorkflowService,
  SPECIALIST_DAEMON_CATALOG,
} from "@eauto/application";
import {
  SPECIALIST_DAEMON_IDS,
  assertSpecialistDaemonCatalog,
  classifyProductLifecycle,
  type AccountBrainDimension,
} from "@eauto/domain";
import { InMemoryCompanyIntelligenceRepository } from "@eauto/infrastructure";

function ids() {
  let sequence = 0;
  return { next: (prefix: string) => `${prefix}-${++sequence}` };
}

describe("company intelligence", () => {
  it("builds a deterministic Account Brain and preserves missing inputs", async () => {
    const repository = new InMemoryCompanyIntelligenceRepository();
    const source = {
      readDimension: ({ dimension }: { dimension: AccountBrainDimension }) =>
        Promise.resolve({
          scoreBps: dimension === "economics" ? 3_000 : 8_500,
          evidenceRefs: [`evidence:${dimension}`],
          missingInputs: dimension === "content" ? ["brand-policy"] : [],
          findings:
            dimension === "economics"
              ? [
                  {
                    kind: "margin-risk",
                    title: "Margin below floor",
                    summary: "Verified economics require attention.",
                    severity: "critical" as const,
                    confidence: "high" as const,
                    evidenceRefs: ["evidence:economics"],
                  },
                ]
              : [],
        }),
      retrieveMemory: () => Promise.resolve([]),
    };
    const service = new AccountBrainService(
      repository,
      source,
      { now: () => new Date("2026-07-28T12:00:00.000Z") },
      ids(),
    );
    const snapshot = await service.rebuild({
      organizationId: "maustian",
      accountId: "plasticov",
      maximumAgeMs: 900_000,
    });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.strategicPriorities[0]).toBe("economics:critical");
    expect(snapshot.missingInputs).toContain("brand-policy");
    expect(await service.latest({ organizationId: "maustian", accountId: "plasticov" })).toEqual(
      snapshot,
    );
  });

  it("keeps exactly sixteen reusable specialist daemon definitions", () => {
    expect(() => assertSpecialistDaemonCatalog(SPECIALIST_DAEMON_CATALOG)).not.toThrow();
    expect(SPECIALIST_DAEMON_CATALOG.map((daemon) => daemon.id)).toEqual(SPECIALIST_DAEMON_IDS);
    expect(SPECIALIST_DAEMON_CATALOG).toHaveLength(16);
    expect(SPECIALIST_DAEMON_CATALOG.every((daemon) => daemon.agentId === daemon.id)).toBe(true);
  });

  it("plans all supply workflows as dry-run proposals and blocks missing business inputs", async () => {
    const repository = new InMemoryCompanyIntelligenceRepository();
    const service = new SupplyWorkflowService(
      repository,
      {
        read: () =>
          Promise.resolve({
            availableKinds: [
              "supplier-evidence",
              "listing-snapshot",
              "inventory-snapshot",
              "economic-snapshot",
              "policy-version",
            ],
            evidenceRefs: ["supplier:1", "listing:MLC1", "profitability:1", "policy:v1"],
            missingInputs: [],
          }),
      },
      { now: () => new Date("2026-07-28T12:00:00.000Z") },
      ids(),
    );
    const result = await service.run({
      organizationId: "maustian",
      accountId: "plasticov",
      kind: "stock.autopause",
      supplierId: "supplier-1",
      listingId: "MLC1",
      requestedBy: "sebastian",
      parameters: {
        maximumAgeMs: 900_000,
        stockFloor: 1,
        stockCeiling: null,
        maximumPurchaseQuantity: null,
        maximumUnitCostMinorClp: null,
        reason: "Verified supplier stock is below the safe floor.",
      },
      evidenceRefs: [],
      dryRun: true,
      idempotencyKey: "supply-idempotency-1",
    });
    expect(result).toMatchObject({
      status: "proposed",
      dryRun: true,
      proposedActionKind: "listing.pause",
    });
    expect(result.steps.every((step) => step.status === "completed")).toBe(true);

    const blocked = await service.run({
      organizationId: "maustian",
      accountId: "plasticov",
      kind: "purchase.opportunistic",
      supplierId: "supplier-1",
      listingId: "MLC1",
      requestedBy: "sebastian",
      parameters: {
        maximumAgeMs: 900_000,
        stockFloor: null,
        stockCeiling: null,
        maximumPurchaseQuantity: null,
        maximumUnitCostMinorClp: null,
        reason: "Review an opportunity without placing an order.",
      },
      evidenceRefs: [],
      dryRun: true,
      idempotencyKey: "supply-idempotency-2",
    });
    expect(blocked.status).toBe("waiting-evidence");
    expect(blocked.missingInputs).toEqual(
      expect.arrayContaining(["maximum-purchase-quantity", "maximum-unit-cost"]),
    );
  });

  it("classifies lifecycle deterministically and escalates stale evidence", async () => {
    const active = classifyProductLifecycle({
      organizationId: "maustian",
      accountId: "plasticov",
      listingId: "MLC1",
      asOf: "2026-07-28T12:00:00.000Z",
      listingActive: true,
      availableQuantity: 5,
      soldUnits30d: 3,
      soldUnits90d: 8,
      visits30d: null,
      lastSaleAt: "2026-07-27T12:00:00.000Z",
      marginBps: 4_000,
      seasonInWindow: null,
      seasonEvidenceConfidence: null,
      evidenceFresh: true,
      evidenceRefs: ["listing:1", "profitability:1"],
    });
    expect(active).toMatchObject({ state: "active", confidence: "high" });
    expect(
      classifyProductLifecycle({
        organizationId: "maustian",
        accountId: "plasticov",
        listingId: "MLC1",
        asOf: "2026-07-28T12:00:00.000Z",
        listingActive: true,
        availableQuantity: 5,
        soldUnits30d: 3,
        soldUnits90d: 8,
        visits30d: null,
        lastSaleAt: "2026-07-27T12:00:00.000Z",
        marginBps: 4_000,
        seasonInWindow: null,
        seasonEvidenceConfidence: null,
        evidenceFresh: false,
        evidenceRefs: ["listing:1"],
      }),
    ).toMatchObject({ state: "uncertain", confidence: "low" });

    const repository = new InMemoryCompanyIntelligenceRepository();
    const lifecycle = new ProductLifecycleService(
      repository,
      {
        readLifecycleInput: () =>
          Promise.resolve({
            listingActive: true,
            availableQuantity: 5,
            soldUnits30d: 3,
            soldUnits90d: 8,
            visits30d: null,
            lastSaleAt: "2026-07-27T12:00:00.000Z",
            marginBps: 4_000,
            seasonInWindow: null,
            seasonEvidenceConfidence: null,
            evidenceFresh: true,
            evidenceRefs: ["listing:1", "profitability:1"],
          }),
        listListingIds: () => Promise.resolve(["MLC1"]),
      },
      { now: () => new Date("2026-07-28T12:00:00.000Z") },
    );
    expect(
      await lifecycle.assess({
        organizationId: "maustian",
        accountId: "plasticov",
        listingId: "MLC1",
      }),
    ).toMatchObject({ state: "active" });
  });
});
