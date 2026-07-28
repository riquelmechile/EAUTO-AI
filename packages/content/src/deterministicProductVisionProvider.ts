import { createHash } from "node:crypto";
import type {
  ForComputingProductVisualFingerprints,
  ForProposingProductCandidates,
  ForSearchingVisualDuplicates,
  ProductSourceImageRequest,
  ProductVisionRequest,
} from "@eauto/application";
import type {
  ProductIdentificationCandidate,
  ProductVisualFingerprint,
  VisualDuplicateCandidate,
} from "@eauto/domain";

export type DeterministicProductVisionFixture = Readonly<{
  contentHash: string;
  candidates: readonly Readonly<{
    id: string;
    canonicalName: string;
    brand: string | null;
    model: string | null;
    categoryHint: string | null;
    confidenceBps: number;
  }>[];
  duplicates: readonly Readonly<{
    productId: string;
    similarityBps: number;
    evidenceRef: string;
  }>[];
}>;

export class DeterministicProductVisionProvider
  implements
    ForComputingProductVisualFingerprints,
    ForProposingProductCandidates,
    ForSearchingVisualDuplicates
{
  private readonly fixtures: ReadonlyMap<string, DeterministicProductVisionFixture>;

  constructor(fixtures: readonly DeterministicProductVisionFixture[]) {
    const indexed = new Map<string, DeterministicProductVisionFixture>();
    for (const fixture of fixtures) {
      if (!fixture.contentHash.trim()) throw new Error("Fixture contentHash is required.");
      if (indexed.has(fixture.contentHash)) {
        throw new Error(`Duplicate product vision fixture ${fixture.contentHash}.`);
      }
      indexed.set(fixture.contentHash, fixture);
    }
    this.fixtures = indexed;
  }

  compute(input: ProductSourceImageRequest): Promise<ProductVisualFingerprint> {
    const digest = createHash("sha256").update(input.contentHash).digest();
    let value = "";
    for (const byte of digest.subarray(0, 8)) value += byte.toString(2).padStart(8, "0");
    return Promise.resolve(
      Object.freeze({
        algorithm: "phash-64" as const,
        version: "deterministic-sha256-prefix-v1",
        value,
        evidenceRef: input.evidenceId,
      }),
    );
  }

  identify(input: ProductVisionRequest): Promise<readonly ProductIdentificationCandidate[]> {
    const fixture = this.fixtures.get(input.contentHash);
    const candidates = (fixture?.candidates ?? []).map((candidate) =>
      Object.freeze({
        ...candidate,
        evidenceRefs: Object.freeze([input.evidenceId]),
      }),
    );
    return Promise.resolve(Object.freeze(candidates));
  }

  search(input: ProductVisionRequest): Promise<readonly VisualDuplicateCandidate[]> {
    const fixture = this.fixtures.get(input.contentHash);
    const duplicates = (fixture?.duplicates ?? []).map((duplicate) =>
      Object.freeze({
        ...duplicate,
        accountId: input.accountId,
      }),
    );
    return Promise.resolve(Object.freeze(duplicates));
  }
}
