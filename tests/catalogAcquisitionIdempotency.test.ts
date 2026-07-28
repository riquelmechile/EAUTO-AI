import { describe, expect, it } from "vitest";
import { CatalogAcquisitionService } from "@eauto/application";
import { InMemoryAcquisitionCandidateRepository } from "@eauto/infrastructure";
import type {
  CatalogAcquisitionPolicy,
  PhotoSimilarityMatch,
  SupplierCatalogOffer,
  VerifiedSourceImageUpload,
} from "@eauto/domain";

const observedAt = "2026-07-28T14:30:00.000Z";
const upload: VerifiedSourceImageUpload = Object.freeze({
  id: "upload-idempotent",
  organizationId: "maustian",
  accountId: "plasticov",
  objectKey: "organizations/maustian/accounts/plasticov/source-images/upload-idempotent.jpg",
  originalFileName: "product.jpg",
  contentType: "image/jpeg",
  sizeBytes: 1_024,
  checksumSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  status: "verified",
  objectUri: "s3://private/source-images/upload-idempotent.jpg",
  createdAt: "2026-07-28T14:00:00.000Z",
  expiresAt: "2026-07-28T18:00:00.000Z",
  verifiedAt: "2026-07-28T14:05:00.000Z",
  rejectionReason: null,
});
const match: PhotoSimilarityMatch = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  sourceImageUploadId: upload.id,
  provider: "visual-search-1",
  externalMatchId: "visual-match-idempotent",
  title: "Cordless sheep clipper",
  candidateUrl: "https://catalog.example/products/clipper",
  similarityBps: 9_000,
  observedAt,
  evidence: Object.freeze({
    id: "visual-evidence-idempotent",
    source: "visual-search-1",
    observedAt,
    contentHash: "a".repeat(64),
  }),
});
const offer: SupplierCatalogOffer = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  supplierSourceId: "supplier-1",
  sku: "CLIPPER-IDEMPOTENT",
  name: "Cordless Sheep Clipper",
  productUrl: "https://supplier.example/products/clipper-idempotent",
  unitCostMinor: 49_000,
  stockQuantity: 25,
  currencyId: "CLP",
  observedAt,
  evidence: Object.freeze({
    id: "catalog-evidence-idempotent",
    source: "supplier-1-catalog",
    observedAt,
    contentHash: "b".repeat(64),
  }),
});
const policy: CatalogAcquisitionPolicy = Object.freeze({
  visualProvider: "visual-search-1",
  supplierSourceIds: Object.freeze(["supplier-1"]),
  minimumSimilarityBps: 8_000,
  maximumEvidenceAgeMs: 4 * 60 * 60_000,
  policyVersion: "catalog-acquisition-v1",
});

function createFixture() {
  let currentTime = new Date("2026-07-28T15:00:00.000Z");
  const repository = new InMemoryAcquisitionCandidateRepository();
  const service = new CatalogAcquisitionService(
    { get: () => Promise.resolve(upload) },
    { findSimilar: () => Promise.resolve([match]) },
    { search: () => Promise.resolve([offer]) },
    repository,
    { now: () => currentTime },
  );
  return {
    service,
    advanceClock: () => {
      currentTime = new Date("2026-07-28T16:00:00.000Z");
    },
  };
}

const request = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  sourceImageUploadId: upload.id,
  policy,
});

describe("catalog acquisition idempotency", () => {
  it("returns the first canonical candidate when identical evidence is rediscovered later", async () => {
    const fixture = createFixture();
    const [first] = await fixture.service.discover(request);
    fixture.advanceClock();
    const [rediscovered] = await fixture.service.discover(request);

    expect(rediscovered).toEqual(first);
    expect(rediscovered?.createdAt).toBe("2026-07-28T15:00:00.000Z");
  });

  it("preserves a human review when the same evidence is rediscovered", async () => {
    const fixture = createFixture();
    const [first] = await fixture.service.discover(request);
    expect(first).toBeDefined();
    const reviewed = await fixture.service.reviewCandidate({
      id: first!.id,
      organizationId: "maustian",
      accountId: "plasticov",
      decision: "accepted",
      reviewedBy: "reviewer-1",
      note: "Confirmed once.",
    });

    fixture.advanceClock();
    const [rediscovered] = await fixture.service.discover(request);

    expect(rediscovered).toEqual(reviewed);
    expect(rediscovered).toMatchObject({
      status: "accepted",
      reviewedBy: "reviewer-1",
      reviewNote: "Confirmed once.",
    });
  });
});
