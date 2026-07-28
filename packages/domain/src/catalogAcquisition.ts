import type { SupplierStockEvidence } from "./supplierStock.js";

export type PhotoSimilarityMatch = Readonly<{
  organizationId: string;
  accountId: string;
  sourceImageUploadId: string;
  provider: string;
  externalMatchId: string;
  title: string;
  candidateUrl: string;
  similarityBps: number;
  observedAt: string;
  evidence: SupplierStockEvidence;
}>;

export type SupplierCatalogOffer = Readonly<{
  organizationId: string;
  accountId: string;
  supplierSourceId: string;
  sku: string;
  name: string;
  productUrl: string;
  unitCostMinor: number;
  stockQuantity: number;
  currencyId: string;
  observedAt: string;
  evidence: SupplierStockEvidence;
}>;

export type CatalogAcquisitionPolicy = Readonly<{
  visualProvider: string;
  supplierSourceIds: readonly string[];
  minimumSimilarityBps: number;
  maximumEvidenceAgeMs: number;
  policyVersion: string;
}>;

export type AcquisitionCandidateStatus = "needs-review" | "accepted" | "rejected";
export type AcquisitionReviewDecision = Exclude<AcquisitionCandidateStatus, "needs-review">;

export type AcquisitionCandidate = Readonly<{
  id: string;
  contentHash: string;
  organizationId: string;
  accountId: string;
  sourceImageUploadId: string;
  visualProvider: string;
  externalMatchId: string;
  similarityBps: number;
  supplierSourceId: string;
  sku: string;
  name: string;
  productUrl: string;
  unitCostMinor: number;
  stockQuantity: number;
  currencyId: string;
  evidenceRefs: readonly [string, string];
  policyVersion: string;
  status: AcquisitionCandidateStatus;
  requiresHumanApproval: true;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
}>;

export class CatalogAcquisitionValidationError extends Error {
  readonly code = "invalid-catalog-acquisition";

  constructor(message: string) {
    super(message);
    this.name = "CatalogAcquisitionValidationError";
  }
}

export class CatalogAcquisitionConflictError extends Error {
  readonly code = "catalog-acquisition-conflict";

  constructor(message: string) {
    super(message);
    this.name = "CatalogAcquisitionConflictError";
  }
}

export class CatalogAcquisitionUnavailableError extends Error {
  readonly code = "catalog-acquisition-unavailable";

  constructor(message = "Catalog acquisition providers are not configured.") {
    super(message);
    this.name = "CatalogAcquisitionUnavailableError";
  }
}

export function reviewAcquisitionCandidate(
  candidate: AcquisitionCandidate,
  input: Readonly<{
    decision: AcquisitionReviewDecision;
    reviewedBy: string;
    reviewedAt: string;
    note?: string | null;
  }>,
): AcquisitionCandidate {
  if (candidate.status !== "needs-review") {
    throw new CatalogAcquisitionConflictError(
      `Candidate ${candidate.id} has already been reviewed.`,
    );
  }
  if (input.decision !== "accepted" && input.decision !== "rejected") {
    throw new CatalogAcquisitionValidationError("Review decision must be accepted or rejected.");
  }
  assertRequired(input.reviewedBy, "reviewedBy");
  const reviewedAt = Date.parse(input.reviewedAt);
  const createdAt = Date.parse(candidate.createdAt);
  if (!Number.isFinite(reviewedAt) || !Number.isFinite(createdAt) || reviewedAt < createdAt) {
    throw new CatalogAcquisitionValidationError(
      "reviewedAt must be a valid timestamp at or after candidate creation.",
    );
  }
  const note = input.note?.trim() || null;
  if (note && note.length > 1_000) {
    throw new CatalogAcquisitionValidationError("Review note cannot exceed 1000 characters.");
  }
  return Object.freeze({
    ...candidate,
    status: input.decision,
    reviewedAt: input.reviewedAt,
    reviewedBy: input.reviewedBy.trim(),
    reviewNote: note,
  });
}

export function validateCatalogAcquisitionPolicy(policy: CatalogAcquisitionPolicy): void {
  assertRequired(policy.visualProvider, "visualProvider");
  assertRequired(policy.policyVersion, "policyVersion");
  assertBasisPoints(policy.minimumSimilarityBps, "minimumSimilarityBps");
  if (!Number.isSafeInteger(policy.maximumEvidenceAgeMs) || policy.maximumEvidenceAgeMs <= 0) {
    throw new CatalogAcquisitionValidationError(
      "maximumEvidenceAgeMs must be a positive safe integer.",
    );
  }
  if (policy.supplierSourceIds.length === 0) {
    throw new CatalogAcquisitionValidationError("At least one supplier source is required.");
  }
  const uniqueSources = new Set<string>();
  for (const supplierSourceId of policy.supplierSourceIds) {
    assertRequired(supplierSourceId, "supplierSourceId");
    if (uniqueSources.has(supplierSourceId)) {
      throw new CatalogAcquisitionValidationError(
        `Supplier source ${supplierSourceId} is configured more than once.`,
      );
    }
    uniqueSources.add(supplierSourceId);
  }
}

export function validatePhotoSimilarityMatch(
  match: PhotoSimilarityMatch,
  expected: Readonly<{
    organizationId: string;
    accountId: string;
    sourceImageUploadId: string;
    provider: string;
  }>,
): PhotoSimilarityMatch {
  assertScope(match.organizationId, expected.organizationId, "organization");
  assertScope(match.accountId, expected.accountId, "account");
  assertScope(match.sourceImageUploadId, expected.sourceImageUploadId, "source image upload");
  assertScope(match.provider, expected.provider, "visual provider");
  assertRequired(match.externalMatchId, "externalMatchId");
  assertRequired(match.title, "title");
  assertHttpsUrl(match.candidateUrl, "candidateUrl");
  assertBasisPoints(match.similarityBps, "similarityBps");
  validateEvidence(match.evidence, match.observedAt, "photo similarity");
  return Object.freeze({ ...match, evidence: Object.freeze({ ...match.evidence }) });
}

export function validateSupplierCatalogOffer(
  offer: SupplierCatalogOffer,
  expected: Readonly<{
    organizationId: string;
    accountId: string;
    supplierSourceId: string;
  }>,
): SupplierCatalogOffer {
  assertScope(offer.organizationId, expected.organizationId, "organization");
  assertScope(offer.accountId, expected.accountId, "account");
  assertScope(offer.supplierSourceId, expected.supplierSourceId, "supplier source");
  assertRequired(offer.sku, "sku");
  assertRequired(offer.name, "name");
  assertHttpsUrl(offer.productUrl, "productUrl");
  assertPositiveSafeInteger(offer.unitCostMinor, "unitCostMinor");
  assertNonNegativeSafeInteger(offer.stockQuantity, "stockQuantity");
  if (!/^[A-Z]{3}$/.test(offer.currencyId)) {
    throw new CatalogAcquisitionValidationError("currencyId must be a three-letter ISO code.");
  }
  validateEvidence(offer.evidence, offer.observedAt, "supplier catalog");
  return Object.freeze({ ...offer, evidence: Object.freeze({ ...offer.evidence }) });
}

export function isCatalogEvidenceFresh(
  evidence: SupplierStockEvidence,
  asOf: Date,
  maximumEvidenceAgeMs: number,
): boolean {
  const observedAt = Date.parse(evidence.observedAt);
  if (!Number.isFinite(observedAt)) return false;
  const age = asOf.getTime() - observedAt;
  return age >= 0 && age <= maximumEvidenceAgeMs;
}

function validateEvidence(
  evidence: SupplierStockEvidence,
  observedAt: string,
  label: string,
): void {
  assertRequired(evidence.id, `${label} evidence id`);
  assertRequired(evidence.source, `${label} evidence source`);
  if (!/^[a-f0-9]{64}$/i.test(evidence.contentHash)) {
    throw new CatalogAcquisitionValidationError(
      `${label} evidence contentHash must be a SHA-256 hex digest.`,
    );
  }
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new CatalogAcquisitionValidationError(`${label} observedAt must be an ISO date.`);
  }
  if (!Number.isFinite(Date.parse(evidence.observedAt))) {
    throw new CatalogAcquisitionValidationError(
      `${label} evidence observedAt must be an ISO date.`,
    );
  }
  if (observedAt !== evidence.observedAt) {
    throw new CatalogAcquisitionValidationError(
      `${label} observation and evidence timestamps must match.`,
    );
  }
}

function assertScope(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new CatalogAcquisitionValidationError(`${label} is outside the requested scope.`);
  }
}

function assertRequired(value: string, field: string): void {
  if (!value.trim()) throw new CatalogAcquisitionValidationError(`${field} is required.`);
}

function assertHttpsUrl(value: string, field: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("invalid");
    }
  } catch {
    throw new CatalogAcquisitionValidationError(
      `${field} must be an HTTPS URL without embedded credentials.`,
    );
  }
}

function assertBasisPoints(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new CatalogAcquisitionValidationError(`${field} must be between 0 and 10000.`);
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CatalogAcquisitionValidationError(`${field} must be a positive safe integer.`);
  }
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CatalogAcquisitionValidationError(`${field} must be a non-negative safe integer.`);
  }
}
