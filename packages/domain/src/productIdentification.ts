export const PRODUCT_IDENTIFICATION_STATUSES = [
  "identified-pending-confirmation",
  "ambiguous",
  "no-match",
  "duplicate-blocked",
  "incomplete",
] as const;

export type ProductIdentificationStatus = (typeof PRODUCT_IDENTIFICATION_STATUSES)[number];

export type ProductImageEvidence = Readonly<{
  id: string;
  sourceImageUploadId: string;
  objectUri: string;
  observedAt: string;
  contentHash: string;
}>;

export type ProductIdentificationCandidate = Readonly<{
  id: string;
  canonicalName: string;
  brand: string | null;
  model: string | null;
  categoryHint: string | null;
  confidenceBps: number;
  evidenceRefs: readonly string[];
}>;

export type VisualDuplicateCandidate = Readonly<{
  productId: string;
  accountId: string;
  similarityBps: number;
  evidenceRef: string;
}>;

export type ProductIdentificationPolicy = Readonly<{
  minimumConfidenceBps: number;
  minimumLeadBps: number;
  duplicateThresholdBps: number;
  maximumEvidenceAgeMs: number;
  policyVersion: string;
}>;

export type ProductIdentificationInput = Readonly<{
  organizationId: string;
  accountId: string;
  sourceImage: ProductImageEvidence;
  candidates: readonly ProductIdentificationCandidate[];
  duplicates: readonly VisualDuplicateCandidate[];
  asOf: string;
}>;

export type ProductIdentificationReason =
  | "candidate-evidence-missing"
  | "duplicate-detected"
  | "evidence-stale"
  | "low-confidence"
  | "no-candidates"
  | "top-candidates-too-close";

export type ProductIdentificationResult = Readonly<{
  organizationId: string;
  accountId: string;
  sourceImageUploadId: string;
  status: ProductIdentificationStatus;
  selectedCandidate: ProductIdentificationCandidate | null;
  alternativeCandidates: readonly ProductIdentificationCandidate[];
  blockingDuplicate: VisualDuplicateCandidate | null;
  reasons: readonly ProductIdentificationReason[];
  evidenceRefs: readonly string[];
  policyVersion: string;
  requiresHumanConfirmation: boolean;
  evaluatedAt: string;
}>;

export function evaluateProductIdentification(
  input: ProductIdentificationInput,
  policy: ProductIdentificationPolicy,
): ProductIdentificationResult {
  validateInput(input);
  validatePolicy(policy);

  const asOf = parseDate(input.asOf, "asOf");
  const observedAt = parseDate(input.sourceImage.observedAt, "sourceImage.observedAt");
  const ageMs = asOf.getTime() - observedAt.getTime();
  const orderedCandidates = [...input.candidates].sort(compareCandidates);
  const orderedDuplicates = [...input.duplicates].sort(compareDuplicates);
  const evidenceRefs = new Set<string>([input.sourceImage.id]);
  for (const candidate of orderedCandidates) {
    for (const reference of candidate.evidenceRefs) evidenceRefs.add(reference);
  }
  for (const duplicate of orderedDuplicates) evidenceRefs.add(duplicate.evidenceRef);

  if (ageMs < 0 || ageMs > policy.maximumEvidenceAgeMs) {
    return result(input, policy, {
      status: "incomplete",
      reasons: ["evidence-stale"],
      candidates: orderedCandidates,
      blockingDuplicate: null,
      evidenceRefs,
    });
  }

  if (
    orderedCandidates.some((candidate) => !candidate.evidenceRefs.includes(input.sourceImage.id))
  ) {
    return result(input, policy, {
      status: "incomplete",
      reasons: ["candidate-evidence-missing"],
      candidates: orderedCandidates,
      blockingDuplicate: null,
      evidenceRefs,
    });
  }

  const blockingDuplicate = orderedDuplicates.find(
    (candidate) => candidate.similarityBps >= policy.duplicateThresholdBps,
  );
  if (blockingDuplicate) {
    return result(input, policy, {
      status: "duplicate-blocked",
      reasons: ["duplicate-detected"],
      candidates: orderedCandidates,
      blockingDuplicate,
      evidenceRefs,
    });
  }

  const top = orderedCandidates[0];
  if (!top) {
    return result(input, policy, {
      status: "no-match",
      reasons: ["no-candidates"],
      candidates: orderedCandidates,
      blockingDuplicate: null,
      evidenceRefs,
    });
  }

  if (top.confidenceBps < policy.minimumConfidenceBps) {
    return result(input, policy, {
      status: "no-match",
      reasons: ["low-confidence"],
      candidates: orderedCandidates,
      blockingDuplicate: null,
      evidenceRefs,
    });
  }

  const second = orderedCandidates[1];
  if (second && top.confidenceBps - second.confidenceBps < policy.minimumLeadBps) {
    return result(input, policy, {
      status: "ambiguous",
      reasons: ["top-candidates-too-close"],
      candidates: orderedCandidates,
      blockingDuplicate: null,
      evidenceRefs,
    });
  }

  return result(input, policy, {
    status: "identified-pending-confirmation",
    reasons: [],
    candidates: orderedCandidates,
    blockingDuplicate: null,
    evidenceRefs,
  });
}

function result(
  input: ProductIdentificationInput,
  policy: ProductIdentificationPolicy,
  decision: Readonly<{
    status: ProductIdentificationStatus;
    reasons: readonly ProductIdentificationReason[];
    candidates: readonly ProductIdentificationCandidate[];
    blockingDuplicate: VisualDuplicateCandidate | null;
    evidenceRefs: ReadonlySet<string>;
  }>,
): ProductIdentificationResult {
  const selectedCandidate =
    decision.status === "identified-pending-confirmation" ? (decision.candidates[0] ?? null) : null;
  const alternatives = selectedCandidate ? decision.candidates.slice(1) : decision.candidates;
  return Object.freeze({
    organizationId: input.organizationId,
    accountId: input.accountId,
    sourceImageUploadId: input.sourceImage.sourceImageUploadId,
    status: decision.status,
    selectedCandidate,
    alternativeCandidates: Object.freeze(alternatives),
    blockingDuplicate: decision.blockingDuplicate,
    reasons: Object.freeze([...decision.reasons]),
    evidenceRefs: Object.freeze([...decision.evidenceRefs].sort()),
    policyVersion: policy.policyVersion,
    requiresHumanConfirmation: decision.status === "identified-pending-confirmation",
    evaluatedAt: input.asOf,
  });
}

function validateInput(input: ProductIdentificationInput): void {
  for (const [field, value] of [
    ["organizationId", input.organizationId],
    ["accountId", input.accountId],
    ["sourceImage.id", input.sourceImage.id],
    ["sourceImage.sourceImageUploadId", input.sourceImage.sourceImageUploadId],
    ["sourceImage.objectUri", input.sourceImage.objectUri],
    ["sourceImage.contentHash", input.sourceImage.contentHash],
  ] as const) {
    if (!value.trim()) throw new Error(`${field} is required.`);
  }
  if (!input.sourceImage.objectUri.startsWith("s3://")) {
    throw new Error("sourceImage.objectUri must be a private S3 URI.");
  }
  const candidateIds = new Set<string>();
  for (const candidate of input.candidates) {
    for (const [field, value] of [
      ["candidate.id", candidate.id],
      ["candidate.canonicalName", candidate.canonicalName],
    ] as const) {
      if (!value.trim()) throw new Error(`${field} is required.`);
    }
    assertBasisPoints(candidate.confidenceBps, "candidate.confidenceBps");
    if (
      candidate.evidenceRefs.length === 0 ||
      candidate.evidenceRefs.some((value) => !value.trim())
    ) {
      throw new Error("candidate.evidenceRefs must contain non-empty references.");
    }
    if (candidateIds.has(candidate.id)) throw new Error(`Duplicate candidate id ${candidate.id}.`);
    candidateIds.add(candidate.id);
  }
  for (const duplicate of input.duplicates) {
    if (!duplicate.productId.trim()) throw new Error("duplicate.productId is required.");
    if (!duplicate.accountId.trim()) throw new Error("duplicate.accountId is required.");
    if (!duplicate.evidenceRef.trim()) throw new Error("duplicate.evidenceRef is required.");
    assertBasisPoints(duplicate.similarityBps, "duplicate.similarityBps");
  }
}

function validatePolicy(policy: ProductIdentificationPolicy): void {
  assertBasisPoints(policy.minimumConfidenceBps, "minimumConfidenceBps");
  assertBasisPoints(policy.minimumLeadBps, "minimumLeadBps");
  assertBasisPoints(policy.duplicateThresholdBps, "duplicateThresholdBps");
  if (!Number.isSafeInteger(policy.maximumEvidenceAgeMs) || policy.maximumEvidenceAgeMs < 0) {
    throw new Error("maximumEvidenceAgeMs must be a non-negative safe integer.");
  }
  if (!policy.policyVersion.trim()) throw new Error("policyVersion is required.");
}

function compareCandidates(
  left: ProductIdentificationCandidate,
  right: ProductIdentificationCandidate,
): number {
  return right.confidenceBps - left.confidenceBps || left.id.localeCompare(right.id);
}

function compareDuplicates(
  left: VisualDuplicateCandidate,
  right: VisualDuplicateCandidate,
): number {
  return right.similarityBps - left.similarityBps || left.productId.localeCompare(right.productId);
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date.`);
  return parsed;
}

function assertBasisPoints(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field} must be an integer between 0 and 10000 basis points.`);
  }
}
