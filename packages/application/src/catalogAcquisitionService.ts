import { createHash } from "node:crypto";
import {
  CatalogAcquisitionValidationError,
  isCatalogEvidenceFresh,
  isVerifiedSourceImageUpload,
  validateCatalogAcquisitionPolicy,
  validatePhotoSimilarityMatch,
  validateSupplierCatalogOffer,
  type AcquisitionCandidate,
  type CatalogAcquisitionPolicy,
  type PhotoSimilarityMatch,
  type SourceImageUpload,
  type SupplierCatalogOffer,
} from "@eauto/domain";
import type { Clock } from "./ports.js";

export type SourceImageReader = {
  get(input: {
    id: string;
    organizationId: string;
    accountId: string;
  }): Promise<SourceImageUpload | null>;
};

export type PhotoSimilarityPort = {
  findSimilar(
    input: Readonly<{
      organizationId: string;
      accountId: string;
      sourceImageUploadId: string;
      objectUri: string;
      checksumSha256Base64: string;
      provider: string;
    }>,
  ): Promise<readonly PhotoSimilarityMatch[]>;
};

export type SupplierCatalogSearchPort = {
  search(
    input: Readonly<{
      organizationId: string;
      accountId: string;
      supplierSourceId: string;
      query: string;
      candidateUrl: string;
    }>,
  ): Promise<readonly SupplierCatalogOffer[]>;
};

export type AcquisitionCandidateRepository = {
  save(candidate: AcquisitionCandidate): Promise<void>;
};

export type DiscoverAcquisitionCandidatesRequest = Readonly<{
  organizationId: string;
  accountId: string;
  sourceImageUploadId: string;
  policy: CatalogAcquisitionPolicy;
}>;

export class CatalogAcquisitionService {
  constructor(
    private readonly sourceImages: SourceImageReader,
    private readonly photoSimilarity: PhotoSimilarityPort,
    private readonly supplierCatalog: SupplierCatalogSearchPort,
    private readonly candidates: AcquisitionCandidateRepository,
    private readonly clock: Clock,
  ) {}

  async discover(
    request: DiscoverAcquisitionCandidatesRequest,
  ): Promise<readonly AcquisitionCandidate[]> {
    validateCatalogAcquisitionPolicy(request.policy);
    const sourceImage = await this.sourceImages.get({
      id: request.sourceImageUploadId,
      organizationId: request.organizationId,
      accountId: request.accountId,
    });
    if (!sourceImage || !isVerifiedSourceImageUpload(sourceImage)) {
      throw new CatalogAcquisitionValidationError(
        "A verified source image for this account is required.",
      );
    }
    assertSourceImageScope(sourceImage, request);

    const now = this.clock.now();
    const matches = await this.photoSimilarity.findSimilar({
      organizationId: request.organizationId,
      accountId: request.accountId,
      sourceImageUploadId: sourceImage.id,
      objectUri: sourceImage.objectUri,
      checksumSha256Base64: sourceImage.checksumSha256Base64,
      provider: request.policy.visualProvider,
    });
    const discovered: AcquisitionCandidate[] = [];
    const seenContentHashes = new Set<string>();

    for (const rawMatch of matches) {
      const match = validatePhotoSimilarityMatch(rawMatch, {
        organizationId: request.organizationId,
        accountId: request.accountId,
        sourceImageUploadId: sourceImage.id,
        provider: request.policy.visualProvider,
      });
      if (match.similarityBps < request.policy.minimumSimilarityBps) continue;
      if (!isCatalogEvidenceFresh(match.evidence, now, request.policy.maximumEvidenceAgeMs)) {
        continue;
      }

      for (const supplierSourceId of request.policy.supplierSourceIds) {
        const offers = await this.supplierCatalog.search({
          organizationId: request.organizationId,
          accountId: request.accountId,
          supplierSourceId,
          query: match.title.trim(),
          candidateUrl: match.candidateUrl,
        });
        for (const rawOffer of offers) {
          const offer = validateSupplierCatalogOffer(rawOffer, {
            organizationId: request.organizationId,
            accountId: request.accountId,
            supplierSourceId,
          });
          if (!isCatalogEvidenceFresh(offer.evidence, now, request.policy.maximumEvidenceAgeMs)) {
            continue;
          }
          const candidate = buildCandidate(request, match, offer, now.toISOString());
          if (seenContentHashes.has(candidate.contentHash)) continue;
          seenContentHashes.add(candidate.contentHash);
          await this.candidates.save(candidate);
          discovered.push(candidate);
        }
      }
    }

    return Object.freeze(discovered);
  }
}

function assertSourceImageScope(
  upload: SourceImageUpload,
  request: DiscoverAcquisitionCandidatesRequest,
): void {
  if (
    upload.id !== request.sourceImageUploadId ||
    upload.organizationId !== request.organizationId ||
    upload.accountId !== request.accountId
  ) {
    throw new CatalogAcquisitionValidationError(
      "Source image upload is outside the requested scope.",
    );
  }
}

function buildCandidate(
  request: DiscoverAcquisitionCandidatesRequest,
  match: PhotoSimilarityMatch,
  offer: SupplierCatalogOffer,
  createdAt: string,
): AcquisitionCandidate {
  const material = {
    organizationId: request.organizationId,
    accountId: request.accountId,
    sourceImageUploadId: request.sourceImageUploadId,
    visualProvider: match.provider,
    externalMatchId: match.externalMatchId,
    similarityBps: match.similarityBps,
    supplierSourceId: offer.supplierSourceId,
    sku: offer.sku,
    name: offer.name,
    productUrl: offer.productUrl,
    unitCostMinor: offer.unitCostMinor,
    stockQuantity: offer.stockQuantity,
    currencyId: offer.currencyId,
    photoEvidenceHash: match.evidence.contentHash,
    catalogEvidenceHash: offer.evidence.contentHash,
    policyVersion: request.policy.policyVersion,
  };
  const contentHash = createHash("sha256").update(JSON.stringify(material)).digest("hex");
  const evidenceRefs: readonly [string, string] = Object.freeze([
    match.evidence.id,
    offer.evidence.id,
  ]);
  return Object.freeze({
    id: `acquisition-${contentHash.slice(0, 32)}`,
    contentHash,
    organizationId: request.organizationId,
    accountId: request.accountId,
    sourceImageUploadId: request.sourceImageUploadId,
    visualProvider: match.provider,
    externalMatchId: match.externalMatchId,
    similarityBps: match.similarityBps,
    supplierSourceId: offer.supplierSourceId,
    sku: offer.sku,
    name: offer.name,
    productUrl: offer.productUrl,
    unitCostMinor: offer.unitCostMinor,
    stockQuantity: offer.stockQuantity,
    currencyId: offer.currencyId,
    evidenceRefs,
    policyVersion: request.policy.policyVersion,
    status: "needs-review",
    requiresHumanApproval: true,
    createdAt,
  });
}
