import type { ProductIdentificationResult } from "./productIdentification.js";
import type { ProductVisualFingerprint } from "./productVisualFingerprint.js";

export type StoredProductIdentification = Readonly<{
  id: string;
  contentHash: string;
  result: ProductIdentificationResult;
  fingerprint: ProductVisualFingerprint;
}>;

export type ProductIdentificationReviewDecision = "confirmed" | "rejected";

export type ProductIdentificationReview = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  identificationId: string;
  sourceImageUploadId: string;
  candidateId: string;
  productId: string | null;
  decision: ProductIdentificationReviewDecision;
  reviewerId: string;
  reason: string | null;
  policyVersion: string;
  evidenceRefs: readonly string[];
  decidedAt: string;
}>;

export type ReviewProductIdentificationInput = Readonly<{
  reviewId: string;
  organizationId: string;
  accountId: string;
  identificationId: string;
  candidateId: string;
  productId: string | null;
  decision: ProductIdentificationReviewDecision;
  reviewerId: string;
  reason: string | null;
  decidedAt: string;
}>;

export function reviewProductIdentification(
  stored: StoredProductIdentification,
  input: ReviewProductIdentificationInput,
): ProductIdentificationReview {
  for (const [field, value] of [
    ["reviewId", input.reviewId],
    ["organizationId", input.organizationId],
    ["accountId", input.accountId],
    ["identificationId", input.identificationId],
    ["candidateId", input.candidateId],
    ["reviewerId", input.reviewerId],
  ] as const) {
    if (!value.trim()) throw new Error(`${field} is required.`);
  }
  if (
    stored.result.organizationId !== input.organizationId ||
    stored.result.accountId !== input.accountId ||
    stored.id !== input.identificationId
  ) {
    throw new Error("Product identification review is outside the requested scope.");
  }
  if (
    stored.result.status !== "identified-pending-confirmation" ||
    !stored.result.requiresHumanConfirmation ||
    !stored.result.selectedCandidate
  ) {
    throw new Error("Only a clear identification pending confirmation can be reviewed.");
  }
  if (stored.result.selectedCandidate.id !== input.candidateId) {
    throw new Error("Review candidate does not match the selected identification candidate.");
  }
  if (input.decision === "confirmed") {
    if (!input.productId?.trim()) throw new Error("Confirmed identification requires productId.");
  } else {
    if (input.productId !== null)
      throw new Error("Rejected identification cannot assign productId.");
    if (!input.reason?.trim()) throw new Error("Rejected identification requires a reason.");
  }
  const decidedAt = parseDate(input.decidedAt, "decidedAt");
  const evaluatedAt = parseDate(stored.result.evaluatedAt, "result.evaluatedAt");
  if (decidedAt.getTime() < evaluatedAt.getTime()) {
    throw new Error("Review cannot predate the product identification result.");
  }

  return Object.freeze({
    id: input.reviewId,
    organizationId: input.organizationId,
    accountId: input.accountId,
    identificationId: input.identificationId,
    sourceImageUploadId: stored.result.sourceImageUploadId,
    candidateId: input.candidateId,
    productId: input.productId,
    decision: input.decision,
    reviewerId: input.reviewerId,
    reason: input.reason,
    policyVersion: stored.result.policyVersion,
    evidenceRefs: Object.freeze([...stored.result.evidenceRefs]),
    decidedAt: input.decidedAt,
  });
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date.`);
  return parsed;
}
