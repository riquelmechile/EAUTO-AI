import { describe, expect, it } from "vitest";
import { ProductIdentificationReviewService } from "@eauto/application";
import type { ProductIdentificationReview, StoredProductIdentification } from "@eauto/domain";

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
      categoryHint: null,
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

describe("ProductIdentificationReviewService", () => {
  it("persists a validated review with the exact stored identification", async () => {
    const saved: { review: ProductIdentificationReview; stored: StoredProductIdentification }[] =
      [];
    const service = new ProductIdentificationReviewService(
      { get: () => Promise.resolve(stored) },
      {
        saveReview: (review, identification) => {
          saved.push({ review, stored: identification });
          return Promise.resolve();
        },
      },
    );

    const review = await service.review({
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

    expect(saved).toEqual([{ review, stored }]);
  });

  it("does not persist when the identification is missing in scope", async () => {
    let saved = false;
    const service = new ProductIdentificationReviewService(
      { get: () => Promise.resolve(null) },
      {
        saveReview: () => {
          saved = true;
          return Promise.resolve();
        },
      },
    );

    await expect(
      service.review({
        reviewId: "review-2",
        organizationId: "maustian",
        accountId: "plasticov",
        identificationId: "missing",
        candidateId: "candidate-a",
        productId: "product-1",
        decision: "confirmed",
        reviewerId: "sebastian",
        reason: null,
        decidedAt: "2026-07-27T13:10:00.000Z",
      }),
    ).rejects.toThrow(/not found/);
    expect(saved).toBe(false);
  });
});
