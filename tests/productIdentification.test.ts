import { describe, expect, it } from "vitest";
import {
  evaluateProductIdentification,
  type ProductIdentificationCandidate,
  type ProductIdentificationInput,
  type ProductIdentificationPolicy,
} from "@eauto/domain";

const policy: ProductIdentificationPolicy = Object.freeze({
  minimumConfidenceBps: 8_500,
  minimumLeadBps: 1_000,
  duplicateThresholdBps: 9_500,
  maximumEvidenceAgeMs: 86_400_000,
  policyVersion: "product-identification-v1",
});

const sourceEvidenceId = "source-image:upload-1:checksum";
const candidate = (
  id: string,
  confidenceBps: number,
  evidenceRefs: readonly string[] = [sourceEvidenceId],
): ProductIdentificationCandidate =>
  Object.freeze({
    id,
    canonicalName: id === "candidate-a" ? "Esquiladora inalámbrica" : "Cortadora de pelo",
    brand: null,
    model: null,
    categoryHint: "Herramientas",
    confidenceBps,
    evidenceRefs: Object.freeze([...evidenceRefs]),
  });

const baseInput: ProductIdentificationInput = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  sourceImage: Object.freeze({
    id: sourceEvidenceId,
    sourceImageUploadId: "upload-1",
    objectUri: "s3://eauto-content/organizations/maustian/accounts/plasticov/upload-1.jpg",
    observedAt: "2026-07-27T12:00:00.000Z",
    contentHash: "checksum",
  }),
  candidates: Object.freeze([candidate("candidate-a", 9_400), candidate("candidate-b", 7_800)]),
  duplicates: Object.freeze([]),
  asOf: "2026-07-27T13:00:00.000Z",
});

describe("product identification domain", () => {
  it("selects a clear candidate but still requires human confirmation", () => {
    const result = evaluateProductIdentification(baseInput, policy);

    expect(result).toMatchObject({
      status: "identified-pending-confirmation",
      requiresHumanConfirmation: true,
      policyVersion: "product-identification-v1",
    });
    expect(result.selectedCandidate?.id).toBe("candidate-a");
    expect(result.alternativeCandidates.map((item) => item.id)).toEqual(["candidate-b"]);
  });

  it("treats close top candidates as ambiguous", () => {
    const result = evaluateProductIdentification(
      {
        ...baseInput,
        candidates: [candidate("candidate-a", 9_200), candidate("candidate-b", 8_500)],
      },
      policy,
    );

    expect(result.status).toBe("ambiguous");
    expect(result.selectedCandidate).toBeNull();
    expect(result.reasons).toContain("top-candidates-too-close");
  });

  it("returns no-match when the best candidate is below confidence policy", () => {
    const result = evaluateProductIdentification(
      { ...baseInput, candidates: [candidate("candidate-a", 8_499)] },
      policy,
    );

    expect(result.status).toBe("no-match");
    expect(result.reasons).toContain("low-confidence");
  });

  it("returns no-match when the provider proposes nothing", () => {
    const result = evaluateProductIdentification({ ...baseInput, candidates: [] }, policy);

    expect(result.status).toBe("no-match");
    expect(result.reasons).toContain("no-candidates");
  });

  it("blocks a visually duplicated product before launch", () => {
    const result = evaluateProductIdentification(
      {
        ...baseInput,
        duplicates: [
          {
            productId: "existing-product-1",
            accountId: "plasticov",
            similarityBps: 9_700,
            evidenceRef: "visual-index:existing-product-1",
          },
        ],
      },
      policy,
    );

    expect(result.status).toBe("duplicate-blocked");
    expect(result.blockingDuplicate?.productId).toBe("existing-product-1");
    expect(result.reasons).toContain("duplicate-detected");
    expect(result.requiresHumanConfirmation).toBe(false);
  });

  it("fails closed when image evidence is stale", () => {
    const result = evaluateProductIdentification(
      { ...baseInput, asOf: "2026-07-29T13:00:00.000Z" },
      policy,
    );

    expect(result.status).toBe("incomplete");
    expect(result.reasons).toContain("evidence-stale");
  });

  it("fails closed when a candidate does not cite the source image", () => {
    const result = evaluateProductIdentification(
      { ...baseInput, candidates: [candidate("candidate-a", 9_500, ["unrelated-evidence"])] },
      policy,
    );

    expect(result.status).toBe("incomplete");
    expect(result.reasons).toContain("candidate-evidence-missing");
  });

  it("orders candidates and duplicate evidence deterministically", () => {
    const result = evaluateProductIdentification(
      {
        ...baseInput,
        candidates: [candidate("candidate-b", 9_000), candidate("candidate-a", 9_000)],
        duplicates: [
          {
            productId: "product-b",
            accountId: "plasticov",
            similarityBps: 9_000,
            evidenceRef: "visual-b",
          },
          {
            productId: "product-a",
            accountId: "plasticov",
            similarityBps: 9_000,
            evidenceRef: "visual-a",
          },
        ],
      },
      { ...policy, minimumLeadBps: 0 },
    );

    expect(result.selectedCandidate?.id).toBe("candidate-a");
    expect(result.evidenceRefs).toEqual([...result.evidenceRefs].sort());
  });
});
