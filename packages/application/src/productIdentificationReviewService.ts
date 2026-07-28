import {
  reviewProductIdentification,
  type ProductIdentificationReview,
  type ReviewProductIdentificationInput,
  type StoredProductIdentification,
} from "@eauto/domain";

export type ForReadingStoredProductIdentifications = {
  get(input: {
    organizationId: string;
    accountId: string;
    identificationId: string;
  }): Promise<StoredProductIdentification | null>;
};

export type ForSavingProductIdentificationReviews = {
  saveReview(
    review: ProductIdentificationReview,
    identification: StoredProductIdentification,
  ): Promise<void>;
};

export class ProductIdentificationReviewService {
  constructor(
    private readonly identifications: ForReadingStoredProductIdentifications,
    private readonly reviews: ForSavingProductIdentificationReviews,
  ) {}

  async review(input: ReviewProductIdentificationInput): Promise<ProductIdentificationReview> {
    const stored = await this.identifications.get({
      organizationId: input.organizationId,
      accountId: input.accountId,
      identificationId: input.identificationId,
    });
    if (!stored) throw new Error("Product identification was not found in the requested scope.");
    const review = reviewProductIdentification(stored, input);
    await this.reviews.saveReview(review, stored);
    return review;
  }
}
