import type { ForProposingProductCandidates, PhotoSimilarityPort } from "@eauto/application";
import type { ProductIdentificationCandidate } from "@eauto/domain";

export class PhotoSimilarityProductCandidateProvider implements ForProposingProductCandidates {
  constructor(
    private readonly similarity: PhotoSimilarityPort,
    private readonly providerName: string,
  ) {
    if (!providerName.trim()) throw new Error("Product candidate provider name is required.");
  }

  async identify(
    input: Parameters<ForProposingProductCandidates["identify"]>[0],
  ): Promise<readonly ProductIdentificationCandidate[]> {
    const matches = await this.similarity.findSimilar({
      organizationId: input.organizationId,
      accountId: input.accountId,
      sourceImageUploadId: input.sourceImageUploadId,
      objectUri: input.objectUri,
      checksumSha256Base64: input.contentHash,
      provider: this.providerName,
    });

    const candidates = matches.map((match) => {
      if (
        match.organizationId !== input.organizationId ||
        match.accountId !== input.accountId ||
        match.sourceImageUploadId !== input.sourceImageUploadId ||
        match.provider !== this.providerName
      ) {
        throw new Error(
          "Photo similarity provider returned a candidate outside the requested scope.",
        );
      }
      return Object.freeze({
        id: `visual:${match.provider}:${match.externalMatchId}`,
        canonicalName: match.title.trim(),
        brand: null,
        model: null,
        categoryHint: null,
        confidenceBps: match.similarityBps,
        evidenceRefs: Object.freeze([input.evidenceId, match.evidence.id]),
      });
    });
    return Object.freeze(candidates);
  }
}
