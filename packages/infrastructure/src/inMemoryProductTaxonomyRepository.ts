import type { ProductTaxonomyResolutionRepository } from "@eauto/application";
import type {
  ProductTaxonomyReview,
  StoredProductTaxonomyResolution,
} from "@eauto/domain";

export class InMemoryProductTaxonomyRepository implements ProductTaxonomyResolutionRepository {
  private readonly resolutions = new Map<string, StoredProductTaxonomyResolution>();
  private readonly reviews = new Map<string, ProductTaxonomyReview>();

  save(resolution: StoredProductTaxonomyResolution): Promise<void> {
    const existing = this.resolutions.get(resolution.id);
    if (existing) {
      if (existing.contentHash !== resolution.contentHash) {
        throw new Error("Product taxonomy resolution idempotency conflict.");
      }
      return Promise.resolve();
    }
    this.resolutions.set(resolution.id, resolution);
    return Promise.resolve();
  }

  get(input: {
    organizationId: string;
    accountId: string;
    resolutionId: string;
  }): Promise<StoredProductTaxonomyResolution | null> {
    const stored = this.resolutions.get(input.resolutionId);
    if (
      !stored ||
      stored.resolution.organizationId !== input.organizationId ||
      stored.resolution.accountId !== input.accountId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(stored);
  }

  saveReview(
    review: ProductTaxonomyReview,
    resolution: StoredProductTaxonomyResolution,
  ): Promise<void> {
    const current = this.resolutions.get(review.resolutionId);
    if (!current || current.contentHash !== resolution.contentHash) {
      throw new Error("Product taxonomy resolution changed before review persistence.");
    }
    const existing = this.reviews.get(review.resolutionId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(review)) {
        throw new Error("Product taxonomy review is already terminal with another decision.");
      }
      return Promise.resolve();
    }
    this.reviews.set(review.resolutionId, review);
    return Promise.resolve();
  }

  getReview(input: {
    organizationId: string;
    accountId: string;
    resolutionId: string;
  }): Promise<ProductTaxonomyReview | null> {
    const review = this.reviews.get(input.resolutionId);
    if (
      !review ||
      review.organizationId !== input.organizationId ||
      review.accountId !== input.accountId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(review);
  }
}
