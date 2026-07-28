import { CatalogAcquisitionConflictError, type AcquisitionCandidate } from "@eauto/domain";
import type { AcquisitionCandidateRepository } from "@eauto/application";

export class InMemoryAcquisitionCandidateRepository implements AcquisitionCandidateRepository {
  private readonly candidates = new Map<string, AcquisitionCandidate>();
  private readonly idsByContentHash = new Map<string, string>();

  save(candidate: AcquisitionCandidate): Promise<void> {
    const byId = this.candidates.get(candidate.id);
    const idByHash = this.idsByContentHash.get(candidate.contentHash);
    if (byId || idByHash) {
      const existing = byId ?? (idByHash ? this.candidates.get(idByHash) : undefined);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(candidate)) {
        throw new CatalogAcquisitionConflictError(
          `Candidate ${candidate.id} already exists with different content.`,
        );
      }
      return Promise.resolve();
    }
    this.candidates.set(candidate.id, candidate);
    this.idsByContentHash.set(candidate.contentHash, candidate.id);
    return Promise.resolve();
  }

  get(input: {
    id: string;
    organizationId: string;
    accountId: string;
  }): Promise<AcquisitionCandidate | null> {
    const candidate = this.candidates.get(input.id);
    if (
      !candidate ||
      candidate.organizationId !== input.organizationId ||
      candidate.accountId !== input.accountId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(candidate);
  }

  list(input: Parameters<AcquisitionCandidateRepository["list"]>[0]): Promise<
    readonly AcquisitionCandidate[]
  > {
    const candidates = [...this.candidates.values()]
      .filter(
        (candidate) =>
          candidate.organizationId === input.organizationId &&
          candidate.accountId === input.accountId &&
          (input.status === undefined || candidate.status === input.status),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit);
    return Promise.resolve(Object.freeze(candidates));
  }

  transition(input: {
    candidate: AcquisitionCandidate;
    expectedStatus: "needs-review";
  }): Promise<void> {
    const current = this.candidates.get(input.candidate.id);
    if (
      !current ||
      current.organizationId !== input.candidate.organizationId ||
      current.accountId !== input.candidate.accountId ||
      current.status !== input.expectedStatus ||
      current.contentHash !== input.candidate.contentHash
    ) {
      throw new CatalogAcquisitionConflictError(
        `Candidate ${input.candidate.id} review transition conflicted.`,
      );
    }
    this.candidates.set(input.candidate.id, input.candidate);
    return Promise.resolve();
  }
}
