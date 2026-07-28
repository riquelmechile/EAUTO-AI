import {
  evaluateProductIdentification,
  type ProductIdentificationCandidate,
  type ProductIdentificationPolicy,
  type ProductIdentificationResult,
  type VerifiedSourceImageUpload,
  type VisualDuplicateCandidate,
} from "@eauto/domain";

export type ProductVisionRequest = Readonly<{
  organizationId: string;
  accountId: string;
  sourceImageUploadId: string;
  objectUri: string;
  contentHash: string;
  evidenceId: string;
}>;

export type ForReadingVerifiedSourceImages = {
  getVerified(input: {
    organizationId: string;
    accountId: string;
    sourceImageUploadId: string;
  }): Promise<VerifiedSourceImageUpload | null>;
};

export type ForProposingProductCandidates = {
  identify(input: ProductVisionRequest): Promise<readonly ProductIdentificationCandidate[]>;
};

export type ForSearchingVisualDuplicates = {
  search(input: ProductVisionRequest): Promise<readonly VisualDuplicateCandidate[]>;
};

export type ForSavingProductIdentificationResults = {
  save(result: ProductIdentificationResult): Promise<void>;
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
    private readonly vision: ForProposingProductCandidates,
    private readonly duplicates: ForSearchingVisualDuplicates,
    private readonly results: ForSavingProductIdentificationResults,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async identifyFromPhoto(
    request: IdentifyProductFromPhotoRequest,
  ): Promise<ProductIdentificationResult> {
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
    const providerRequest = Object.freeze({
      organizationId: request.organizationId,
      accountId: request.accountId,
      sourceImageUploadId: sourceImage.id,
      objectUri: sourceImage.objectUri,
      contentHash: sourceImage.checksumSha256Base64,
      evidenceId,
    });
    const [candidates, duplicates] = await Promise.all([
      this.vision.identify(providerRequest),
      this.duplicates.search(providerRequest),
    ]);

    for (const duplicate of duplicates) {
      if (duplicate.accountId !== request.accountId) {
        throw new Error("Visual duplicate reader returned data outside the requested account.");
      }
    }

    const result = evaluateProductIdentification(
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
        asOf: this.now().toISOString(),
      }),
      request.policy,
    );
    await this.results.save(result);
    return result;
  }
}

function assertRequired(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}
