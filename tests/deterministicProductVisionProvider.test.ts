import { describe, expect, it } from "vitest";
import { DeterministicProductVisionProvider } from "@eauto/content";

const request = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  sourceImageUploadId: "upload-1",
  objectUri: "s3://eauto-content/upload-1.jpg",
  contentHash: "fixture-hash",
  evidenceId: "source-image:upload-1:fixture-hash",
});

describe("DeterministicProductVisionProvider", () => {
  it("maps a verified image hash to cited candidates and scoped duplicates", async () => {
    const provider = new DeterministicProductVisionProvider([
      {
        contentHash: "fixture-hash",
        candidates: [
          {
            id: "candidate-a",
            canonicalName: "Esquiladora inalámbrica",
            brand: null,
            model: null,
            categoryHint: "Herramientas",
            confidenceBps: 9_500,
          },
        ],
        duplicates: [
          {
            productId: "existing-product",
            similarityBps: 9_000,
            evidenceRef: "visual-index:existing-product",
          },
        ],
      },
    ]);

    await expect(provider.identify(request)).resolves.toEqual([
      expect.objectContaining({
        id: "candidate-a",
        evidenceRefs: [request.evidenceId],
      }),
    ]);
    await expect(provider.search(request)).resolves.toEqual([
      expect.objectContaining({
        productId: "existing-product",
        accountId: "plasticov",
      }),
    ]);
  });

  it("returns empty proposals for an unknown image instead of inventing identity", async () => {
    const provider = new DeterministicProductVisionProvider([]);

    await expect(provider.identify(request)).resolves.toEqual([]);
    await expect(provider.search(request)).resolves.toEqual([]);
  });

  it("rejects duplicate fixture hashes", () => {
    expect(
      () =>
        new DeterministicProductVisionProvider([
          { contentHash: "same", candidates: [], duplicates: [] },
          { contentHash: "same", candidates: [], duplicates: [] },
        ]),
    ).toThrow(/Duplicate product vision fixture/);
  });
});
