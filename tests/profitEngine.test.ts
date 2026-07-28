import { describe, expect, it } from "vitest";
import {
  calculateProfitability,
  prepareRepricingProposal,
  type EconomicCostComponent,
  type EconomicEvidenceReference,
  type ProfitabilityInput,
} from "../packages/domain/src/profitEngine.js";

const observedAt = "2026-07-27T12:00:00.000Z";
const asOf = "2026-07-27T13:00:00.000Z";

function evidence(id: string): EconomicEvidenceReference {
  return {
    id,
    source: "authoritative-test-source",
    observedAt,
    contentHash: id.padEnd(64, "0").slice(0, 64),
  };
}

function cost(kind: EconomicCostComponent["kind"], amountMinor: number): EconomicCostComponent {
  return { kind, amountMinor, evidence: evidence(`evidence-${kind}`) };
}

function input(overrides: Partial<ProfitabilityInput> = {}): ProfitabilityInput {
  return {
    accountId: "plasticov",
    listingId: "MLC123",
    currency: "CLP",
    salePriceMinor: 10_000,
    quantity: 1,
    variableRateBps: 1_600,
    variableRateEvidence: evidence("marketplace-fee"),
    costs: [cost("product-cost", 5_000), cost("fulfillment-cost", 1_000)],
    minimumMarginBps: 3_000,
    asOf,
    maximumEvidenceAgeMs: 24 * 60 * 60 * 1_000,
    ...overrides,
  };
}

describe("profit engine", () => {
  it("calculates a deterministic below-floor snapshot", () => {
    const snapshot = calculateProfitability(input());
    expect(snapshot).toMatchObject({
      status: "below-floor",
      grossRevenueMinor: 10_000,
      fixedCostsMinor: 6_000,
      variableCostsMinor: 1_600,
      totalCostsMinor: 7_600,
      netProfitMinor: 2_400,
      marginBps: 2_400,
    });
  });

  it("classifies profitable and loss-making listings", () => {
    expect(calculateProfitability(input({ salePriceMinor: 13_000 })).status).toBe("profitable");
    expect(calculateProfitability(input({ salePriceMinor: 7_000 })).status).toBe("loss");
  });

  it("fails closed when mandatory economic inputs are missing", () => {
    const snapshot = calculateProfitability(
      input({
        variableRateBps: null,
        variableRateEvidence: null,
        costs: [cost("product-cost", 5_000)],
      }),
    );
    expect(snapshot).toEqual({
      status: "incomplete",
      accountId: "plasticov",
      listingId: "MLC123",
      currency: "CLP",
      salePriceMinor: 10_000,
      quantity: 1,
      minimumMarginBps: 3_000,
      missingInputs: ["fulfillment-cost", "marketplace-fee-rate"],
      staleEvidenceIds: [],
      evidenceRefs: ["evidence-product-cost"],
    });
  });

  it("treats stale evidence as incomplete instead of inventing current costs", () => {
    const stale = evidence("stale-product-cost");
    const snapshot = calculateProfitability(
      input({
        maximumEvidenceAgeMs: 1_000,
        costs: [
          { kind: "product-cost", amountMinor: 5_000, evidence: stale },
          cost("fulfillment-cost", 1_000),
        ],
      }),
    );
    expect(snapshot.status).toBe("incomplete");
    if (snapshot.status === "incomplete") {
      expect(snapshot.staleEvidenceIds).toContain("stale-product-cost");
    }
  });

  it("prepares an approval-required price proposal that reaches the target margin", () => {
    const snapshot = calculateProfitability(input());
    const decision = prepareRepricingProposal(snapshot, {
      targetMarginBps: 3_000,
      maximumIncreaseBps: 2_000,
      policyVersion: "pricing-v1",
    });
    expect(decision).toEqual({
      status: "proposed",
      accountId: "plasticov",
      listingId: "MLC123",
      currency: "CLP",
      currentPriceMinor: 10_000,
      proposedPriceMinor: 11_112,
      currentMarginBps: 2_400,
      projectedMarginBps: 3_000,
      targetMarginBps: 3_000,
      evidenceRefs: ["evidence-fulfillment-cost", "evidence-product-cost", "marketplace-fee"],
      policyVersion: "pricing-v1",
      requiresApproval: true,
    });
  });

  it("does not propose a change when margin already meets policy", () => {
    const snapshot = calculateProfitability(input({ salePriceMinor: 13_000 }));
    expect(
      prepareRepricingProposal(snapshot, {
        targetMarginBps: 3_000,
        maximumIncreaseBps: 2_000,
        policyVersion: "pricing-v1",
      }),
    ).toEqual({
      status: "no-change",
      reason: "margin-at-or-above-target",
      currentMarginBps: 3_784,
      targetMarginBps: 3_000,
    });
  });

  it("blocks proposals that exceed the allowed increase or competitive ceiling", () => {
    const snapshot = calculateProfitability(input());
    expect(
      prepareRepricingProposal(snapshot, {
        targetMarginBps: 3_000,
        maximumIncreaseBps: 500,
        policyVersion: "pricing-v1",
      }),
    ).toEqual({
      status: "blocked",
      reason: "maximum-increase-exceeded",
      requiredPriceMinor: 11_112,
    });
    expect(
      prepareRepricingProposal(snapshot, {
        targetMarginBps: 3_000,
        maximumIncreaseBps: 2_000,
        competitiveCeilingMinor: 11_000,
        policyVersion: "pricing-v1",
      }),
    ).toEqual({
      status: "blocked",
      reason: "competitive-ceiling-exceeded",
      requiredPriceMinor: 11_112,
    });
  });
});
