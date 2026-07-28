import { createHash } from "node:crypto";
import {
  evaluateProductIdentification,
  validateProductVisualFingerprint,
  type ProductIdentificationCandidate,
  type ProductIdentificationPolicy,
  type ProductIdentificationResult,
  type ProductVisualFingerprint,
  type StoredProductIdentification,
  type VerifiedSourceImageUpload,
  type VisualDuplicateCandidate,
} from "@eauto/domain";

export type ProductSourceImageRequest = Readonly<{
  organizationId: string;
  accountId: string;
  sourceImageUploadId: string;
  objectUri: string;
  contentHash: string;
  evidenceId: string;
}>;

export type ProductVisionRequest = ProductSourceImageRequest &
  Readonly<{
    fingerprint: ProductVisualFingerprint;
  }>;

export type ProductIdentificationArtifact = StoredProductIdentification;

export type ForReadingVerifiedSourceImages = {
  getVerified(input: {
    organizationId: string;
    accountId: string;
    sourceImageUploadId: string;
  }): Promise<VerifiedSourceImageUpload | null>;
};

export type ForComputingProductVisualFingerprints = {
  compute(input: ProductSourceImageRequest): Promise<ProductVisualFingerprint>;
};

export type ForProposingProductCandidates = {
  identify(input: ProductVisionRequest): Promise<readonly ProductIdentificationCandidate[]>;
};

export type ForSearchingVisualDuplicates = {
  search(input: ProductVisionRequest): Promise<readonly VisualDuplicateCandidate[]>;
};

export type ForSavingProductIdentificationResults = {
  save(artifact: ProductIdentificationArtifact): Promise<void>;
};

export type IdentifyProductFromPhotoRequest = Readonly<{
  organizationId: string;
  accountId: string;
  sourceImageUploadId: string;
  policy: ProductIdentificationPolicy;
}>;

export class ProductIdentificationService {
  constructor(
    private readonly sourceImages: ForReadingVerifiedSourceImages,
    private readonly fingerprints: ForComputingProductVisualFingerprints,
    private readonly vision: ForProposingProductCandidates,
    private readonly duplicates: ForSearchingVisualDuplicates,
    private readonly results: ForSavingProductIdentificationResults,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async identifyFromPhoto(
    request: IdentifyProductFromPhotoRequest,
  ): Promise<ProductIdentificationResult> {
    return (await this.identifyStoredFromPhoto(request)).result;
  }

  async identifyStoredFromPhoto(
    request: IdentifyProductFromPhotoRequest,
  ): Promise<StoredProductIdentification> {
    assertRequired(request.organizationId, "organizationId");
    assertRequired(request.accountId, "accountId");
    assertRequired(request.sourceImageUploadId, "sourceImageUploadId");

    const sourceImage = await this.sourceImages.getVerified({
      organizationId: request.organizationId,
      accountId: request.accountId,
      sourceImageUploadId: request.sourceImageUploadId,
    });
    if (!sourceImage) {
      throw new Error("A verified source image in the requested account scope is required.");
    }
    if (
      sourceImage.organizationId !== request.organizationId ||
      sourceImage.accountId !== request.accountId ||
      sourceImage.id !== request.sourceImageUploadId
    ) {
      throw new Error("Source image reader returned data outside the requested scope.");
    }

    const evidenceId = `source-image:${sourceImage.id}:${sourceImage.checksumSha256Base64}`;
    const sourceRequest: ProductSourceImageRequest = Object.freeze({
      organizationId: request.organizationId,
      accountId: request.accountId,
      sourceImageUploadId: sourceImage.id,
      objectUri: sourceImage.objectUri,
      contentHash: sourceImage.checksumSha256Base64,
      evidenceId,
    });
    const fingerprint = validateProductVisualFingerprint(
      await this.fingerprints.compute(sourceRequest),
    );
    if (fingerprint.evidenceRef !== evidenceId) {
      throw new Error("Visual fingerprint does not cite the verified source image.");
    }

    const providerRequest: ProductVisionRequest = Object.freeze({
      ...sourceRequest,
      fingerprint,
    });
    const asOf = this.now().toISOString();
    const evaluate = (
      candidates: readonly ProductIdentificationCandidate[],
      duplicates: readonly VisualDuplicateCandidate[],
    ): ProductIdentificationResult =>
      evaluateProductIdentification(
        Object.freeze({
          organizationId: request.organizationId,
          accountId: request.accountId,
          sourceImage: Object.freeze({
            id: evidenceId,
            sourceImageUploadId: sourceImage.id,
            objectUri: sourceImage.objectUri,
            observedAt: sourceImage.verifiedAt,
            contentHash: sourceImage.checksumSha256Base64,
          }),
          candidates: Object.freeze([...candidates]),
          duplicates: Object.freeze([...duplicates]),
          asOf,
        }),
        request.policy,
      );

    const evidencePreflight = evaluate([], []);
    if (evidencePreflight.status === "incomplete") {
      return this.persist(evidencePreflight, fingerprint);
    }

    const duplicates = await this.duplicates.search(providerRequest);
    for (const duplicate of duplicates) {
      if (duplicate.accountId !== request.accountId) {
        throw new Error("Visual duplicate reader returned data outside the requested account.");
      }
    }

    const duplicatePreflight = evaluate([], duplicates);
    if (duplicatePreflight.status === "duplicate-blocked") {
      return this.persist(duplicatePreflight, fingerprint);
    }

    const candidates = await this.vision.identify(providerRequest);
    const result = evaluate(candidates, duplicates);
    return this.persist(result, fingerprint);
  }

  private async persist(
    result: ProductIdentificationResult,
    fingerprint: ProductVisualFingerprint,
  ): Promise<StoredProductIdentification> {
    const artifact = createProductIdentificationArtifact(result, fingerprint);
    await this.results.save(artifact);
    return artifact;
  }
}

export function createProductIdentificationArtifact(
  result: ProductIdentificationResult,
  fingerprint: ProductVisualFingerprint,
): StoredProductIdentification {
  const material = canonicalize({ result, fingerprint });
  const contentHash = createHash("sha256").update(JSON.stringify(material)).digest("hex");
  return Object.freeze({
    id: `product_identification_${contentHash}`,
    contentHash,
    result,
    fingerprint,
  });
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
