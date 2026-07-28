import { createHash } from "node:crypto";
import {
  createProductTaxonomyResolution,
  reviewProductTaxonomy,
  type ProductIdentificationReview,
  type ProductTaxonomyPolicy,
  type ProductTaxonomyPrediction,
  type ProductTaxonomyReview,
  type ReviewProductTaxonomyInput,
  type StoredProductIdentification,
  type StoredProductTaxonomyResolution,
} from "@eauto/domain";

export type ForReadingConfirmedProductIdentifications = {
  get(input: {
    organizationId: string;
    accountId: string;
    identificationId: string;
  }): Promise<StoredProductIdentification | null>;
};

export type ForReadingProductIdentificationReviews = {
  getReview(input: {
    organizationId: string;
    accountId: string;
    identificationId: string;
  }): Promise<ProductIdentificationReview | null>;
};

export type ForResolvingMercadoLibreProductTaxonomy = {
  resolveProductTaxonomy(input: {
    organizationId: string;
    accountId: string;
    query: string;
    predictionLimit: number;
    predictionTarget: "core";
  }): Promise<readonly ProductTaxonomyPrediction[]>;
};

export type ProductTaxonomyResolutionRepository = {
  save(resolution: StoredProductTaxonomyResolution): Promise<void>;
  get(input: {
    organizationId: string;
    accountId: string;
    resolutionId: string;
  }): Promise<StoredProductTaxonomyResolution | null>;
  saveReview(
    review: ProductTaxonomyReview,
    resolution: StoredProductTaxonomyResolution,
  ): Promise<void>;
  getReview(input: {
    organizationId: string;
    accountId: string;
    resolutionId: string;
  }): Promise<ProductTaxonomyReview | null>;
};

export class ProductTaxonomyResolutionService {
  constructor(
    private readonly identifications: ForReadingConfirmedProductIdentifications,
    private readonly identificationReviews: ForReadingProductIdentificationReviews,
    private readonly taxonomy: ForResolvingMercadoLibreProductTaxonomy,
    private readonly resolutions: ProductTaxonomyResolutionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(input: {
    organizationId: string;
    accountId: string;
    identificationId: string;
    policy: ProductTaxonomyPolicy;
  }): Promise<StoredProductTaxonomyResolution> {
    assertRequired(input.organizationId, "organizationId");
    assertRequired(input.accountId, "accountId");
    assertRequired(input.identificationId, "identificationId");

    const [identification, review] = await Promise.all([
      this.identifications.get({
        organizationId: input.organizationId,
        accountId: input.accountId,
        identificationId: input.identificationId,
      }),
      this.identificationReviews.getReview({
        organizationId: input.organizationId,
        accountId: input.accountId,
        identificationId: input.identificationId,
      }),
    ]);
    if (!identification) {
      throw new Error("Product identification was not found in the requested scope.");
    }
    if (
      !review ||
      review.decision !== "confirmed" ||
      !review.productId ||
      review.organizationId !== input.organizationId ||
      review.accountId !== input.accountId ||
      review.identificationId !== input.identificationId
    ) {
      throw new Error("A confirmed Product Identification review is required for taxonomy resolution.");
    }
    const candidate = identification.result.selectedCandidate;
    if (!candidate || candidate.id !== review.candidateId) {
      throw new Error("Confirmed Product Identification candidate is unavailable or inconsistent.");
    }

    const query = buildTaxonomyQuery(candidate);
    const predictions = await this.taxonomy.resolveProductTaxonomy({
      organizationId: input.organizationId,
      accountId: input.accountId,
      query,
      predictionLimit: input.policy.predictionLimit,
      predictionTarget: input.policy.predictionTarget,
    });
    const resolution = createProductTaxonomyResolution({
      organizationId: input.organizationId,
      accountId: input.accountId,
      identificationId: input.identificationId,
      productId: review.productId,
      query,
      predictions,
      policy: input.policy,
      evaluatedAt: this.now().toISOString(),
    });
    const stored = createProductTaxonomyArtifact(resolution);
    await this.resolutions.save(stored);
    return stored;
  }
}

export class ProductTaxonomyReviewService {
  constructor(private readonly resolutions: ProductTaxonomyResolutionRepository) {}

  async review(input: ReviewProductTaxonomyInput): Promise<ProductTaxonomyReview> {
    const stored = await this.resolutions.get({
      organizationId: input.organizationId,
      accountId: input.accountId,
      resolutionId: input.resolutionId,
    });
    if (!stored) throw new Error("Product taxonomy resolution was not found in the requested scope.");
    const review = reviewProductTaxonomy(stored, input);
    await this.resolutions.saveReview(review, stored);
    return review;
  }
}

export function createProductTaxonomyArtifact(
  resolution: StoredProductTaxonomyResolution["resolution"],
): StoredProductTaxonomyResolution {
  const contentHash = hashCanonical(resolution);
  return Object.freeze({
    id: `product_taxonomy_${contentHash}`,
    contentHash,
    resolution,
  });
}

function buildTaxonomyQuery(
  candidate: NonNullable<StoredProductIdentification["result"]["selectedCandidate"]>,
): string {
  const parts = [candidate.canonicalName, candidate.brand, candidate.model]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  const query = [...new Set(parts)].join(" ").replaceAll(/\s+/g, " ").trim();
  if (!query) throw new Error("Confirmed Product Identification cannot produce a taxonomy query.");
  return query.slice(0, 200);
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function assertRequired(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}
