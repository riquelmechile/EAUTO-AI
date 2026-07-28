import { describe, expect, it } from "vitest";
import {
  ProductIdentificationService,
  type ProductIdentificationArtifact,
  type ProductSourceImageRequest,
} from "@eauto/application";
import type { ProductIdentificationPolicy, VerifiedSourceImageUpload } from "@eauto/domain";

const policy: ProductIdentificationPolicy = Object.freeze({
  minimumConfidenceBps: 8_500,
  minimumLeadBps: 1_000,
  duplicateThresholdBps: 9_500,
  maximumEvidenceAgeMs: 86_400_000,
  policyVersion: "product-identification-v1",
});

const upload: VerifiedSourceImageUpload = Object.freeze({
  id: "upload-preflight",
  organizationId: "maustian",
  accountId: "plasticov",
  objectKey: "organizations/maustian/accounts/plasticov/source-images/upload-preflight.jpg",
  originalFileName: "product.jpg",
  contentType: "image/jpeg",
  sizeBytes: 1_024,
  checksumSha256Base64: `${"B".repeat(43)}=`,
  status: "verified",
  objectUri: "s3://eauto-content/organizations/maustian/accounts/plasticov/upload-preflight.jpg",
  createdAt: "2026-07-27T11:50:00.000Z",
  expiresAt: "2026-07-27T12:50:00.000Z",
  verifiedAt: "2026-07-27T12:00:00.000Z",
  rejectionReason: null,
});

function fingerprint(request: ProductSourceImageRequest) {
  return Promise.resolve(
    Object.freeze({
      algorithm: "phash-64" as const,
      version: "test-v1",
      value: "0".repeat(64),
      evidenceRef: request.evidenceId,
    }),
  );
}

describe("ProductIdentificationService deterministic preflight", () => {
  it("persists stale evidence as incomplete without calling duplicate or vision providers", async () => {
    const saved: ProductIdentificationArtifact[] = [];
    let duplicateCalls = 0;
    let visionCalls = 0;
    const service = new ProductIdentificationService(
      { getVerified: () => Promise.resolve(upload) },
      { compute: fingerprint },
      {
        identify: () => {
          visionCalls += 1;
          return Promise.resolve([]);
        },
      },
      {
        search: () => {
          duplicateCalls += 1;
          return Promise.resolve([]);
        },
      },
      {
        save: (artifact) => {
          saved.push(artifact);
          return Promise.resolve();
        },
      },
      () => new Date("2026-07-29T12:00:00.001Z"),
    );

    const result = await service.identifyFromPhoto({
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: upload.id,
      policy,
    });

    expect(result.status).toBe("incomplete");
    expect(result.reasons).toEqual(["evidence-stale"]);
    expect(duplicateCalls).toBe(0);
    expect(visionCalls).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.result).toBe(result);
    expect(saved[0]?.fingerprint.version).toBe("test-v1");
  });

  it("blocks a known duplicate before calling the vision provider", async () => {
    const saved: ProductIdentificationArtifact[] = [];
    let visionCalls = 0;
    const service = new ProductIdentificationService(
      { getVerified: () => Promise.resolve(upload) },
      { compute: fingerprint },
      {
        identify: () => {
          visionCalls += 1;
          return Promise.resolve([]);
        },
      },
      {
        search: () =>
          Promise.resolve([
            Object.freeze({
              productId: "existing-product",
              accountId: "plasticov",
              similarityBps: 9_900,
              evidenceRef: "confirmed-product-fingerprint",
            }),
          ]),
      },
      {
        save: (artifact) => {
          saved.push(artifact);
          return Promise.resolve();
        },
      },
      () => new Date("2026-07-27T13:00:00.000Z"),
    );

    const result = await service.identifyFromPhoto({
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: upload.id,
      policy,
    });

    expect(result.status).toBe("duplicate-blocked");
    expect(result.blockingDuplicate?.productId).toBe("existing-product");
    expect(visionCalls).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.result).toBe(result);
    expect(saved[0]?.fingerprint.version).toBe("test-v1");
  });
});
