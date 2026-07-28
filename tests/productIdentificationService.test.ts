import { describe, expect, it } from "vitest";
import { ProductIdentificationService } from "@eauto/application";
import type {
  ProductIdentificationPolicy,
  ProductIdentificationResult,
  VerifiedSourceImageUpload,
} from "@eauto/domain";

const policy: ProductIdentificationPolicy = Object.freeze({
  minimumConfidenceBps: 8_500,
  minimumLeadBps: 1_000,
  duplicateThresholdBps: 9_500,
  maximumEvidenceAgeMs: 86_400_000,
  policyVersion: "product-identification-v1",
});

const upload: VerifiedSourceImageUpload = Object.freeze({
  id: "upload-1",
  organizationId: "maustian",
  accountId: "plasticov",
  objectKey: "organizations/maustian/accounts/plasticov/source-images/upload-1.jpg",
  originalFileName: "product.jpg",
  contentType: "image/jpeg",
  sizeBytes: 1_024,
  checksumSha256Base64: `${"A".repeat(43)}=`,
  status: "verified",
  objectUri: "s3://eauto-content/organizations/maustian/accounts/plasticov/upload-1.jpg",
  createdAt: "2026-07-27T11:50:00.000Z",
  expiresAt: "2026-07-27T12:50:00.000Z",
  verifiedAt: "2026-07-27T12:00:00.000Z",
  rejectionReason: null,
});

describe("ProductIdentificationService", () => {
  it("uses only a verified scoped image and persists the governed result", async () => {
    const saved: ProductIdentificationResult[] = [];
    let providerEvidenceId = "";
    const service = new ProductIdentificationService(
      {
        getVerified: () => Promise.resolve(upload),
      },
      {
        identify: (request) => {
          providerEvidenceId = request.evidenceId;
          return Promise.resolve([
            {
              id: "candidate-a",
              canonicalName: "Esquiladora inalámbrica",
              brand: null,
              model: null,
              categoryHint: "Herramientas",
              confidenceBps: 9_500,
              evidenceRefs: [request.evidenceId],
            },
          ]);
        },
      },
      {
        search: () => Promise.resolve([]),
      },
      {
        save: (result) => {
          saved.push(result);
          return Promise.resolve();
        },
      },
      () => new Date("2026-07-27T13:00:00.000Z"),
    );

    const result = await service.identifyFromPhoto({
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: "upload-1",
      policy,
    });

    expect(result.status).toBe("identified-pending-confirmation");
    expect(providerEvidenceId).toContain("source-image:upload-1:");
    expect(saved).toEqual([result]);
  });

  it("does not call providers when the image is not verified in scope", async () => {
    let called = false;
    const service = new ProductIdentificationService(
      { getVerified: () => Promise.resolve(null) },
      {
        identify: () => {
          called = true;
          return Promise.resolve([]);
        },
      },
      {
        search: () => {
          called = true;
          return Promise.resolve([]);
        },
      },
      { save: () => Promise.resolve() },
    );

    await expect(
      service.identifyFromPhoto({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        policy,
      }),
    ).rejects.toThrow(/verified source image/);
    expect(called).toBe(false);
  });

  it("rejects a source image returned from another account", async () => {
    const service = new ProductIdentificationService(
      {
        getVerified: () => Promise.resolve({ ...upload, accountId: "maustian" }),
      },
      { identify: () => Promise.resolve([]) },
      { search: () => Promise.resolve([]) },
      { save: () => Promise.resolve() },
    );

    await expect(
      service.identifyFromPhoto({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        policy,
      }),
    ).rejects.toThrow(/outside the requested scope/);
  });

  it("rejects duplicate search results from another account", async () => {
    let saved = false;
    const service = new ProductIdentificationService(
      { getVerified: () => Promise.resolve(upload) },
      {
        identify: (request) =>
          Promise.resolve([
            {
              id: "candidate-a",
              canonicalName: "Esquiladora inalámbrica",
              brand: null,
              model: null,
              categoryHint: null,
              confidenceBps: 9_500,
              evidenceRefs: [request.evidenceId],
            },
          ]),
      },
      {
        search: () =>
          Promise.resolve([
            {
              productId: "foreign-product",
              accountId: "maustian",
              similarityBps: 9_900,
              evidenceRef: "foreign-evidence",
            },
          ]),
      },
      {
        save: () => {
          saved = true;
          return Promise.resolve();
        },
      },
    );

    await expect(
      service.identifyFromPhoto({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        policy,
      }),
    ).rejects.toThrow(/outside the requested account/);
    expect(saved).toBe(false);
  });
});
