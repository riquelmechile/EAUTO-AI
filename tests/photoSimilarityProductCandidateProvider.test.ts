import { describe, expect, it } from "vitest";
import { PhotoSimilarityProductCandidateProvider } from "@eauto/infrastructure";

const observedAt = "2026-07-28T15:00:00.000Z";
const request = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  sourceImageUploadId: "upload-1",
  objectUri: "s3://eauto-content/upload-1.jpg",
  contentHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  evidenceId: "source-image:upload-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  fingerprint: Object.freeze({
    algorithm: "sha256-prefix-64" as const,
    version: "deterministic-sha256-prefix-v1",
    value: "0".repeat(64),
    evidenceRef: "source-image:upload-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  }),
});

function match(overrides: Record<string, unknown> = {}) {
  return Object.freeze({
    organizationId: "maustian",
    accountId: "plasticov",
    sourceImageUploadId: "upload-1",
    provider: "visual-provider",
    externalMatchId: "match-1",
    title: "Cordless sheep clipper",
    candidateUrl: "https://catalog.example.com/products/clipper",
    similarityBps: 9_100,
    observedAt,
    evidence: Object.freeze({
      id: "visual-evidence-1",
      source: "visual-provider",
      observedAt,
      contentHash: "a".repeat(64),
    }),
    ...overrides,
  });
}

describe("PhotoSimilarityProductCandidateProvider", () => {
  it("maps an allowlisted scoped visual observation into a cited candidate", async () => {
    const provider = new PhotoSimilarityProductCandidateProvider(
      { findSimilar: () => Promise.resolve([match()]) },
      "visual-provider",
    );

    await expect(provider.identify(request)).resolves.toEqual([
      {
        id: "visual:visual-provider:match-1",
        canonicalName: "Cordless sheep clipper",
        brand: null,
        model: null,
        categoryHint: null,
        confidenceBps: 9_100,
        evidenceRefs: [request.evidenceId, "visual-evidence-1"],
      },
    ]);
  });

  it("rejects provider observations returned outside the requested scope", async () => {
    const provider = new PhotoSimilarityProductCandidateProvider(
      { findSimilar: () => Promise.resolve([match({ accountId: "maustian" })]) },
      "visual-provider",
    );

    await expect(provider.identify(request)).rejects.toThrow(/outside the requested scope/);
  });

  it("rejects observations that claim another provider identity", async () => {
    const provider = new PhotoSimilarityProductCandidateProvider(
      { findSimilar: () => Promise.resolve([match({ provider: "attacker-provider" })]) },
      "visual-provider",
    );

    await expect(provider.identify(request)).rejects.toThrow(/outside the requested scope/);
  });
});
