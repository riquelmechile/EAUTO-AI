import { describe, expect, it } from "vitest";
import { ProfitEngineService } from "../packages/application/src/profitEngineService.js";
import type {
  ProfitabilityInput,
  ProfitabilitySnapshot,
  RepricingProposal,
} from "../packages/domain/src/profitEngine.js";

const input: ProfitabilityInput = {
  accountId: "plasticov",
  listingId: "MLC123",
  currency: "CLP",
  salePriceMinor: 10_000,
  quantity: 1,
  variableRateBps: 1_600,
  variableRateEvidence: {
    id: "fee",
    source: "mercadolibre",
    observedAt: "2026-07-27T12:00:00.000Z",
    contentHash: "a".repeat(64),
  },
  costs: [
    {
      kind: "product-cost",
      amountMinor: 5_000,
      evidence: {
        id: "product-cost",
        source: "supplier",
        observedAt: "2026-07-27T12:00:00.000Z",
        contentHash: "b".repeat(64),
      },
    },
    {
      kind: "fulfillment-cost",
      amountMinor: 1_000,
      evidence: {
        id: "fulfillment-cost",
        source: "mercadolibre",
        observedAt: "2026-07-27T12:00:00.000Z",
        contentHash: "c".repeat(64),
      },
    },
  ],
  minimumMarginBps: 3_000,
  asOf: "2026-07-27T13:00:00.000Z",
  maximumEvidenceAgeMs: 86_400_000,
};

describe("ProfitEngineService", () => {
  it("persists the deterministic snapshot and approval-gated proposal", async () => {
    const snapshots: ProfitabilitySnapshot[] = [];
    const proposals: RepricingProposal[] = [];
    const service = new ProfitEngineService(
      { read: () => Promise.resolve(input) },
      { save: (snapshot) => void snapshots.push(snapshot) || Promise.resolve() },
      { save: (proposal) => void proposals.push(proposal) || Promise.resolve() },
    );

    const decision = await service.prepareRepricing("plasticov", "MLC123", {
      targetMarginBps: 3_000,
      maximumIncreaseBps: 2_000,
      policyVersion: "pricing-v1",
    });

    expect(snapshots).toHaveLength(1);
    expect(proposals).toHaveLength(1);
    expect(decision).toMatchObject({ status: "proposed", requiresApproval: true });
  });

  it("rejects an adapter that returns another account or listing", async () => {
    const service = new ProfitEngineService(
      { read: () => Promise.resolve({ ...input, accountId: "maustian" }) },
      { save: () => Promise.resolve() },
      { save: () => Promise.resolve() },
    );

    await expect(service.auditListing("plasticov", "MLC123")).rejects.toThrow(
      /outside the requested scope/,
    );
  });

  it("does not persist a repricing proposal when economics are incomplete", async () => {
    const proposals: RepricingProposal[] = [];
    const service = new ProfitEngineService(
      {
        read: () =>
          Promise.resolve({
            ...input,
            variableRateBps: null,
            variableRateEvidence: null,
          }),
      },
      { save: () => Promise.resolve() },
      { save: (proposal) => void proposals.push(proposal) || Promise.resolve() },
    );

    const decision = await service.prepareRepricing("plasticov", "MLC123", {
      targetMarginBps: 3_000,
      maximumIncreaseBps: 2_000,
      policyVersion: "pricing-v1",
    });

    expect(decision.status).toBe("blocked");
    expect(proposals).toHaveLength(0);
  });
});
