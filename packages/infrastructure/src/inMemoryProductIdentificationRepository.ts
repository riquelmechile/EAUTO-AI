import type {
  ForReadingProductIdentificationReviews,
  ForReadingStoredProductIdentifications,
  ForSavingProductIdentificationResults,
  ForSavingProductIdentificationReviews,
  ForSearchingVisualDuplicates,
  ProductIdentificationArtifact,
  ProductVisionRequest,
} from "@eauto/application";
import {
  calculateProductFingerprintSimilarityBps,
  type ProductIdentificationReview,
  type ProductVisualFingerprint,
  type StoredProductIdentification,
  type VisualDuplicateCandidate,
} from "@eauto/domain";

export class InMemoryProductIdentificationRepository
  implements
    ForSavingProductIdentificationResults,
    ForReadingStoredProductIdentifications,
    ForSavingProductIdentificationReviews,
    ForReadingProductIdentificationReviews,
    ForSearchingVisualDuplicates
{
  private readonly identifications = new Map<string, StoredProductIdentification>();
  private readonly reviews = new Map<string, ProductIdentificationReview>();
  private readonly fingerprints = new Map<
    string,
    Readonly<{
      organizationId: string;
      accountId: string;
      productId: string;
      identificationId: string;
      fingerprint: ProductVisualFingerprint;
    }>
  >();

  save(artifact: ProductIdentificationArtifact): Promise<void> {
    const existing = this.identifications.get(artifact.id);
    if (existing) {
      if (existing.contentHash !== artifact.contentHash) {
        throw new Error("Product identification idempotency conflict.");
      }
      return Promise.resolve();
    }
    this.identifications.set(artifact.id, artifact);
    return Promise.resolve();
  }

  get(input: {
    organizationId: string;
    accountId: string;
    identificationId: string;
  }): Promise<StoredProductIdentification | null> {
    const stored = this.identifications.get(input.identificationId);
    if (
      !stored ||
      stored.result.organizationId !== input.organizationId ||
      stored.result.accountId !== input.accountId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(stored);
  }

  getReview(input: {
    organizationId: string;
    accountId: string;
    identificationId: string;
  }): Promise<ProductIdentificationReview | null> {
    const review = this.reviews.get(input.identificationId);
    if (
      !review ||
      review.organizationId !== input.organizationId ||
      review.accountId !== input.accountId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(review);
  }

  saveReview(
    review: ProductIdentificationReview,
    identification: StoredProductIdentification,
  ): Promise<void> {
    const current = this.identifications.get(review.identificationId);
    if (!current || current.contentHash !== identification.contentHash) {
      throw new Error("Product identification changed before review persistence.");
    }
    const existingReview = this.reviews.get(review.identificationId);
    if (existingReview) {
      if (JSON.stringify(existingReview) !== JSON.stringify(review)) {
        throw new Error("Product identification review is already terminal with another decision.");
      }
      return Promise.resolve();
    }

    if (review.decision === "confirmed") {
      if (!review.productId) throw new Error("Confirmed review is missing productId.");
      const key = fingerprintKey(
        review.organizationId,
        review.accountId,
        review.productId,
        identification.fingerprint,
      );
      const existingFingerprint = this.fingerprints.get(key);
      if (
        existingFingerprint &&
        (existingFingerprint.identificationId !== review.identificationId ||
          JSON.stringify(existingFingerprint.fingerprint) !==
            JSON.stringify(identification.fingerprint))
      ) {
        throw new Error("Confirmed product already has a different product fingerprint.");
      }
      this.fingerprints.set(
        key,
        Object.freeze({
          organizationId: review.organizationId,
          accountId: review.accountId,
          productId: review.productId,
          identificationId: review.identificationId,
          fingerprint: identification.fingerprint,
        }),
      );
    }

    this.reviews.set(review.identificationId, review);
    return Promise.resolve();
  }

  search(input: ProductVisionRequest): Promise<readonly VisualDuplicateCandidate[]> {
    const matches = [...this.fingerprints.values()]
      .filter(
        (stored) =>
          stored.organizationId === input.organizationId &&
          stored.accountId === input.accountId &&
          stored.fingerprint.algorithm === input.fingerprint.algorithm &&
          stored.fingerprint.version === input.fingerprint.version,
      )
      .map((stored) =>
        Object.freeze({
          productId: stored.productId,
          accountId: input.accountId,
          similarityBps: calculateProductFingerprintSimilarityBps(
            stored.fingerprint.algorithm,
            stored.fingerprint.value,
            input.fingerprint.value,
          ),
          evidenceRef: stored.fingerprint.evidenceRef,
        }),
      )
      .sort(
        (left, right) =>
          right.similarityBps - left.similarityBps || left.productId.localeCompare(right.productId),
      )
      .slice(0, 20);
    return Promise.resolve(Object.freeze(matches));
  }
}

function fingerprintKey(
  organizationId: string,
  accountId: string,
  productId: string,
  fingerprint: ProductVisualFingerprint,
): string {
  return [organizationId, accountId, productId, fingerprint.algorithm, fingerprint.version].join(
    ":",
  );
}
