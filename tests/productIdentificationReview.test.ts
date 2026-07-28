import { describe, expect, it } from "vitest";
import {
  calculateVisualSimilarityBps,
  reviewProductIdentification,
  validateProductVisualFingerprint,
  type StoredProductIdentification,
} from "@eauto/domain";

const stored: StoredProductIdentification = Object.freeze({
  id: "identification-1",
  contentHash: "a".repeat(64),
  result: Object.freeze({
    organizationId: "maustian",
    accountId: "plasticov",
    sourceImageUploadId: "upload-1",
    status: "identified-pending-confirmation",
    selectedCandidate: Object.freeze({
      id: "candidate-a",
      canonicalName: "Esquiladora inalámbrica",
      brand: null,
      model: null,
      categoryHint: "Herramientas",
      confidenceBps: 9_500,
      evidenceRefs: Object.freeze(["source-evidence"]),
    }),
    alternativeCandidates: Object.freeze([]),
    blockingDuplicate: null,
    reasons: Object.freeze([]),
    evidenceRefs: Object.freeze(["source-evidence"]),
    policyVersion: "product-identification-v1",
    requiresHumanConfirmation: true,
    evaluatedAt: "2026-07-27T13:00:00.000Z",
  }),
  fingerprint: Object.freeze({
    algorithm: "phash-64",
    version: "test-v1",
    value: "0".repeat(64),
    evidenceRef: "source-evidence",
  }),
});

describe("product identification review", () => {
  it("confirms only the selected candidate and assigns a product id", () => {
    const review = reviewProductIdentification(stored, {
      reviewId: "review-1",
      organizationId: "maustian",
      accountId: "plasticov",
      identificationId: "identification-1",
      candidateId: "candidate-a",
      productId: "product-1",
      decision: "confirmed",
      reviewerId: "sebastian",
      reason: null,
      decidedAt: "2026-07-27T13:10:00.000Z",
    });

    expect(review).toMatchObject({
      decision: "confirmed",
      productId: "product-1",
      candidateId: "candidate-a",
      policyVersion: "product-identification-v1",
    });
  });

  it("requires a reason and forbids product assignment when rejected", () => {
    const review = reviewProductIdentification(stored, {
      reviewId: "review-2",
      organizationId: "maustian",
      accountId: "plasticov",
      identificationId: "identification-1",
      candidateId: "candidate-a",
      productId: null,
      decision: "rejected",
      reviewerId: "sebastian",
      reason: "The proposed identity is not the photographed product.",
      decidedAt: "2026-07-27T13:10:00.000Z",
    });

    expect(review.decision).toBe("rejected");
    expect(review.productId).toBeNull();
  });

  it("rejects a review from another account", () => {
    expect(() =>
      reviewProductIdentification(stored, {
        reviewId: "review-3",
        organizationId: "maustian",
        accountId: "maustian",
        identificationId: "identification-1",
        candidateId: "candidate-a",
        productId: "product-1",
        decision: "confirmed",
        reviewerId: "sebastian",
        reason: null,
        decidedAt: "2026-07-27T13:10:00.000Z",
      }),
    ).toThrow(/outside the requested scope/);
  });

  it("cannot confirm an ambiguous result", () => {
    expect(() =>
      reviewProductIdentification(
        {
          ...stored,
          result: {
            ...stored.result,
            status: "ambiguous",
            selectedCandidate: null,
            requiresHumanConfirmation: false,
          },
        },
        {
          reviewId: "review-4",
          organizationId: "maustian",
          accountId: "plasticov",
          identificationId: "identification-1",
          candidateId: "candidate-a",
          productId: "product-1",
          decision: "confirmed",
          reviewerId: "sebastian",
          reason: null,
          decidedAt: "2026-07-27T13:10:00.000Z",
        },
      ),
    ).toThrow(/pending confirmation/);
  });
});

describe("product visual fingerprints", () => {
  it("validates 64-bit fingerprints and computes deterministic similarity", () => {
    expect(
      validateProductVisualFingerprint({
        algorithm: "phash-64",
        version: "test-v1",
        value: "0".repeat(64),
        evidenceRef: "source-evidence",
      }),
    ).toBeTruthy();
    expect(calculateVisualSimilarityBps("0".repeat(64), "0".repeat(64))).toBe(10_000);
    expect(calculateVisualSimilarityBps("0".repeat(64), "1".repeat(64))).toBe(0);
    expect(calculateVisualSimilarityBps(`${"0".repeat(32)}${"1".repeat(32)}`, "0".repeat(64))).toBe(
      5_000,
    );
  });
});
