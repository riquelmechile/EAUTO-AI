export const PRODUCT_TAXONOMY_STATUSES = ["resolved-pending-review", "no-prediction"] as const;
export type ProductTaxonomyStatus = (typeof PRODUCT_TAXONOMY_STATUSES)[number];

export type MercadoLibrePredictedAttribute = Readonly<{
  id: string;
  valueId: string | null;
  valueName: string | null;
}>;

export type MercadoLibreAttributeValue = Readonly<{
  id: string;
  name: string;
}>;

export type MercadoLibreCategoryAttribute = Readonly<{
  id: string;
  name: string;
  valueType: string;
  required: boolean;
  catalogRequired: boolean;
  fixed: boolean;
  values: readonly MercadoLibreAttributeValue[];
}>;

export type ProductTaxonomyPrediction = Readonly<{
  domainId: string;
  domainName: string;
  categoryId: string;
  categoryName: string;
  suggestedAttributes: readonly MercadoLibrePredictedAttribute[];
  categoryAttributes: readonly MercadoLibreCategoryAttribute[];
  requiredAttributeIds: readonly string[];
  catalogRequiredAttributeIds: readonly string[];
  evidenceRefs: readonly string[];
  sourceHash: string;
}>;

export type ProductTaxonomyPolicy = Readonly<{
  siteId: "MLC";
  predictionLimit: number;
  predictionTarget: "core";
  policyVersion: string;
}>;

export type ProductTaxonomyResolution = Readonly<{
  organizationId: string;
  accountId: string;
  identificationId: string;
  productId: string;
  query: string;
  status: ProductTaxonomyStatus;
  proposedCategoryId: string | null;
  predictions: readonly ProductTaxonomyPrediction[];
  evidenceRefs: readonly string[];
  policyVersion: string;
  requiresHumanReview: boolean;
  evaluatedAt: string;
}>;

export type StoredProductTaxonomyResolution = Readonly<{
  id: string;
  contentHash: string;
  resolution: ProductTaxonomyResolution;
}>;

export type ProductTaxonomyReviewDecision = "confirmed" | "rejected";

export type ProductTaxonomyReview = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  resolutionId: string;
  identificationId: string;
  productId: string;
  decision: ProductTaxonomyReviewDecision;
  categoryId: string | null;
  reviewerId: string;
  reason: string | null;
  policyVersion: string;
  evidenceRefs: readonly string[];
  decidedAt: string;
}>;

export type ReviewProductTaxonomyInput = Readonly<{
  reviewId: string;
  organizationId: string;
  accountId: string;
  resolutionId: string;
  decision: ProductTaxonomyReviewDecision;
  categoryId: string | null;
  reviewerId: string;
  reason: string | null;
  decidedAt: string;
}>;

export function createProductTaxonomyResolution(input: {
  organizationId: string;
  accountId: string;
  identificationId: string;
  productId: string;
  query: string;
  predictions: readonly ProductTaxonomyPrediction[];
  policy: ProductTaxonomyPolicy;
  evaluatedAt: string;
}): ProductTaxonomyResolution {
  validateRequired(input.organizationId, "organizationId");
  validateRequired(input.accountId, "accountId");
  validateRequired(input.identificationId, "identificationId");
  validateRequired(input.productId, "productId");
  validateRequired(input.query, "query");
  validatePolicy(input.policy);
  parseDate(input.evaluatedAt, "evaluatedAt");
  if (input.query.length > 200) throw new Error("Product taxonomy query cannot exceed 200 characters.");
  if (input.predictions.length > input.policy.predictionLimit) {
    throw new Error("Product taxonomy predictions exceed the server policy limit.");
  }

  const categoryIds = new Set<string>();
  const normalizedPredictions = input.predictions.map((prediction) => {
    validatePrediction(prediction, input.policy.siteId);
    if (categoryIds.has(prediction.categoryId)) {
      throw new Error(`Duplicate product taxonomy category ${prediction.categoryId}.`);
    }
    categoryIds.add(prediction.categoryId);
    return freezePrediction(prediction);
  });
  const evidenceRefs = Object.freeze(
    [...new Set(normalizedPredictions.flatMap((prediction) => prediction.evidenceRefs))].sort(),
  );
  const proposed = normalizedPredictions[0] ?? null;
  return Object.freeze({
    organizationId: input.organizationId,
    accountId: input.accountId,
    identificationId: input.identificationId,
    productId: input.productId,
    query: input.query,
    status: proposed ? "resolved-pending-review" : "no-prediction",
    proposedCategoryId: proposed?.categoryId ?? null,
    predictions: Object.freeze(normalizedPredictions),
    evidenceRefs,
    policyVersion: input.policy.policyVersion,
    requiresHumanReview: proposed !== null,
    evaluatedAt: input.evaluatedAt,
  });
}

export function reviewProductTaxonomy(
  stored: StoredProductTaxonomyResolution,
  input: ReviewProductTaxonomyInput,
): ProductTaxonomyReview {
  for (const [field, value] of [
    ["reviewId", input.reviewId],
    ["organizationId", input.organizationId],
    ["accountId", input.accountId],
    ["resolutionId", input.resolutionId],
    ["reviewerId", input.reviewerId],
  ] as const) {
    validateRequired(value, field);
  }
  if (
    stored.id !== input.resolutionId ||
    stored.resolution.organizationId !== input.organizationId ||
    stored.resolution.accountId !== input.accountId
  ) {
    throw new Error("Product taxonomy review is outside the requested scope.");
  }
  if (
    stored.resolution.status !== "resolved-pending-review" ||
    !stored.resolution.requiresHumanReview
  ) {
    throw new Error("Only a taxonomy resolution pending human review can be reviewed.");
  }
  if (input.decision === "confirmed") {
    if (!input.categoryId?.trim()) {
      throw new Error("Confirmed taxonomy review requires categoryId.");
    }
    if (!stored.resolution.predictions.some((prediction) => prediction.categoryId === input.categoryId)) {
      throw new Error("Confirmed taxonomy category must exist in the persisted predictions.");
    }
  } else {
    if (input.categoryId !== null) throw new Error("Rejected taxonomy review cannot select categoryId.");
    if (!input.reason?.trim()) throw new Error("Rejected taxonomy review requires a reason.");
  }
  const decidedAt = parseDate(input.decidedAt, "decidedAt");
  const evaluatedAt = parseDate(stored.resolution.evaluatedAt, "resolution.evaluatedAt");
  if (decidedAt.getTime() < evaluatedAt.getTime()) {
    throw new Error("Taxonomy review cannot predate the resolution.");
  }
  return Object.freeze({
    id: input.reviewId,
    organizationId: input.organizationId,
    accountId: input.accountId,
    resolutionId: input.resolutionId,
    identificationId: stored.resolution.identificationId,
    productId: stored.resolution.productId,
    decision: input.decision,
    categoryId: input.categoryId,
    reviewerId: input.reviewerId,
    reason: input.reason,
    policyVersion: stored.resolution.policyVersion,
    evidenceRefs: Object.freeze([...stored.resolution.evidenceRefs]),
    decidedAt: input.decidedAt,
  });
}

function validatePrediction(prediction: ProductTaxonomyPrediction, siteId: "MLC"): void {
  for (const [field, value] of [
    ["domainId", prediction.domainId],
    ["domainName", prediction.domainName],
    ["categoryId", prediction.categoryId],
    ["categoryName", prediction.categoryName],
    ["sourceHash", prediction.sourceHash],
  ] as const) {
    validateRequired(value, `prediction.${field}`);
  }
  if (!prediction.domainId.startsWith(`${siteId}-`)) {
    throw new Error(`Product taxonomy domain ${prediction.domainId} is outside site ${siteId}.`);
  }
  if (!prediction.categoryId.startsWith(siteId)) {
    throw new Error(`Product taxonomy category ${prediction.categoryId} is outside site ${siteId}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(prediction.sourceHash)) {
    throw new Error("Product taxonomy prediction sourceHash must be SHA-256 hex.");
  }
  if (prediction.evidenceRefs.length === 0 || prediction.evidenceRefs.some((value) => !value.trim())) {
    throw new Error("Product taxonomy prediction requires evidence references.");
  }
  const attributeIds = new Set<string>();
  for (const attribute of prediction.categoryAttributes) {
    validateRequired(attribute.id, "categoryAttribute.id");
    validateRequired(attribute.name, "categoryAttribute.name");
    validateRequired(attribute.valueType, "categoryAttribute.valueType");
    if (attributeIds.has(attribute.id)) throw new Error(`Duplicate category attribute ${attribute.id}.`);
    attributeIds.add(attribute.id);
    const valueIds = new Set<string>();
    for (const value of attribute.values) {
      validateRequired(value.id, "categoryAttribute.value.id");
      validateRequired(value.name, "categoryAttribute.value.name");
      if (valueIds.has(value.id)) throw new Error(`Duplicate category attribute value ${value.id}.`);
      valueIds.add(value.id);
    }
  }
  const expectedRequired = prediction.categoryAttributes
    .filter((attribute) => attribute.required)
    .map((attribute) => attribute.id)
    .sort();
  const expectedCatalogRequired = prediction.categoryAttributes
    .filter((attribute) => attribute.catalogRequired)
    .map((attribute) => attribute.id)
    .sort();
  if (JSON.stringify([...prediction.requiredAttributeIds].sort()) !== JSON.stringify(expectedRequired)) {
    throw new Error("requiredAttributeIds do not match category attribute tags.");
  }
  if (
    JSON.stringify([...prediction.catalogRequiredAttributeIds].sort()) !==
    JSON.stringify(expectedCatalogRequired)
  ) {
    throw new Error("catalogRequiredAttributeIds do not match category attribute tags.");
  }
}

function validatePolicy(policy: ProductTaxonomyPolicy): void {
  if (policy.siteId !== "MLC") throw new Error("Product taxonomy site must be MLC.");
  if (!Number.isSafeInteger(policy.predictionLimit) || policy.predictionLimit < 1 || policy.predictionLimit > 8) {
    throw new Error("Product taxonomy predictionLimit must be an integer between 1 and 8.");
  }
  if (policy.predictionTarget !== "core") throw new Error("Product taxonomy target must be core.");
  validateRequired(policy.policyVersion, "policyVersion");
}

function freezePrediction(prediction: ProductTaxonomyPrediction): ProductTaxonomyPrediction {
  return Object.freeze({
    ...prediction,
    suggestedAttributes: Object.freeze(
      prediction.suggestedAttributes.map((attribute) => Object.freeze({ ...attribute })),
    ),
    categoryAttributes: Object.freeze(
      prediction.categoryAttributes.map((attribute) =>
        Object.freeze({
          ...attribute,
          values: Object.freeze(attribute.values.map((value) => Object.freeze({ ...value }))),
        }),
      ),
    ),
    requiredAttributeIds: Object.freeze([...prediction.requiredAttributeIds]),
    catalogRequiredAttributeIds: Object.freeze([...prediction.catalogRequiredAttributeIds]),
    evidenceRefs: Object.freeze([...prediction.evidenceRefs]),
  });
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date.`);
  return parsed;
}

function validateRequired(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}
