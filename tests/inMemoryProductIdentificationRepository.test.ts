import { describe, expect, it } from "vitest";
import {
  ProductIdentificationReviewService,
  createProductIdentificationArtifact,
} from "@eauto/application";
import type { ProductIdentificationResult } from "@eauto/domain";
import { InMemoryProductIdentificationRepository } from "@eauto/infrastructure";

const result: ProductIdentificationResult = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  sourceImageUploadId: "upload-1",
  status: "identified-pending-confirmation",
  selectedCandidate: Object.freeze({
    id: "candidate-1",
    canonicalName: "Esquiladora inalámbrica",
    brand: null,
    model: null,
    categoryHint: "Herramientas",
    confidenceBps: 9_500,
    evidenceRefs: Object.freeze(["source-image:upload-1:checksum"]),
  }),
  alternativeCandidates: Object.freeze([]),
  blockingDuplicate: null,
  reasons: Object.freeze([]),
  evidenceRefs: Object.freeze(["source-image:upload-1:checksum"]),
  policyVersion: "catalog-acquisition-v1:product-identification-v1",
  requiresHumanConfirmation: true,
  evaluatedAt: "2026-07-28T15:00:00.000Z",
});
const artifact = createProductIdentificationArtifact(
  result,
  Object.freeze({
    algorithm: "sha256-prefix-64",
    version: "deterministic-sha256-prefix-v1",
    value: "0".repeat(64),
    evidenceRef: "source-image:upload-1:checksum",
  }),
);

function visionRequest(value = "0".repeat(64)) {
  return Object.freeze({
    organizationId: "maustian",
    accountId: "plasticov",
    sourceImageUploadId: "upload-2",
    objectUri: "s3://eauto-content/upload-2.jpg",
    contentHash: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
    evidenceId: "source-image:upload-2:checksum",
    fingerprint: Object.freeze({
      ...artifact.fingerprint,
      value,
      evidenceRef: "source-image:upload-2:checksum",
    }),
  });
}

describe("InMemoryProductIdentificationRepository", () => {
  it("persists canonical artifacts idempotently and hides cross-account reads", async () => {
    const repository = new InMemoryProductIdentificationRepository();

    await repository.save(artifact);
    await repository.save(artifact);

    await expect(
      repository.get({
        organizationId: "maustian",
        accountId: "plasticov",
        identificationId: artifact.id,
      }),
    ).resolves.toEqual(artifact);
    await expect(
      repository.get({
        organizationId: "maustian",
        accountId: "maustian",
        identificationId: artifact.id,
      }),
    ).resolves.toBeNull();
  });

  it("indexes a confirmed exact-content fingerprint and preserves exact semantics", async () => {
    const repository = new InMemoryProductIdentificationRepository();
    const reviews = new ProductIdentificationReviewService(repository, repository);
    await repository.save(artifact);

    await reviews.review({
      reviewId: "review-1",
      organizationId: "maustian",
      accountId: "plasticov",
      identificationId: artifact.id,
      candidateId: "candidate-1",
      productId: "product-1",
      decision: "confirmed",
      reviewerId: "reviewer-1",
      reason: null,
      decidedAt: "2026-07-28T15:05:00.000Z",
    });

    await expect(repository.search(visionRequest())).resolves.toEqual([
      expect.objectContaining({ productId: "product-1", similarityBps: 10_000 }),
    ]);
    await expect(repository.search(visionRequest(`1${"0".repeat(63)}`))).resolves.toEqual([
      expect.objectContaining({ productId: "product-1", similarityBps: 0 }),
    ]);
  });

  it("rejects a contradictory terminal review", async () => {
    const repository = new InMemoryProductIdentificationRepository();
    const reviews = new ProductIdentificationReviewService(repository, repository);
    await repository.save(artifact);
    await reviews.review({
      reviewId: "review-1",
      organizationId: "maustian",
      accountId: "plasticov",
      identificationId: artifact.id,
      candidateId: "candidate-1",
      productId: "product-1",
      decision: "confirmed",
      reviewerId: "reviewer-1",
      reason: null,
      decidedAt: "2026-07-28T15:05:00.000Z",
    });

    await expect(
      reviews.review({
        reviewId: "review-2",
        organizationId: "maustian",
        accountId: "plasticov",
        identificationId: artifact.id,
        candidateId: "candidate-1",
        productId: null,
        decision: "rejected",
        reviewerId: "reviewer-1",
        reason: "Contradictory decision",
        decidedAt: "2026-07-28T15:06:00.000Z",
      }),
    ).rejects.toThrow(/already terminal/);
  });
});
