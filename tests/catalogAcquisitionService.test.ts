import { describe, expect, it } from "vitest";
import { CatalogAcquisitionService } from "@eauto/application";
import { InMemoryAcquisitionCandidateRepository } from "@eauto/infrastructure";
import type {
  PhotoSimilarityMatch,
  SourceImageUpload,
  SupplierCatalogOffer,
  VerifiedSourceImageUpload,
} from "@eauto/domain";

const now = new Date("2026-07-28T15:00:00.000Z");
const observedAt = "2026-07-28T14:30:00.000Z";
const verifiedUpload: VerifiedSourceImageUpload = Object.freeze({
  id: "upload-1",
  organizationId: "maustian",
  accountId: "plasticov",
  objectKey: "organizations/maustian/accounts/plasticov/source-images/upload-1.jpg",
  originalFileName: "product.jpg",
  contentType: "image/jpeg",
  sizeBytes: 1_024,
  checksumSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  status: "verified",
  objectUri: "s3://private/source-images/upload-1.jpg",
  createdAt: "2026-07-28T14:00:00.000Z",
  expiresAt: "2026-07-28T15:30:00.000Z",
  verifiedAt: "2026-07-28T14:05:00.000Z",
  rejectionReason: null,
});
const match: PhotoSimilarityMatch = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  sourceImageUploadId: "upload-1",
  provider: "visual-search-1",
  externalMatchId: "visual-match-1",
  title: "Cordless sheep clipper",
  candidateUrl: "https://catalog.example/products/clipper",
  similarityBps: 8_800,
  observedAt,
  evidence: Object.freeze({
    id: "visual-evidence-1",
    source: "visual-search-1",
    observedAt,
    contentHash: "a".repeat(64),
  }),
});
const offer: SupplierCatalogOffer = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  supplierSourceId: "supplier-1",
  sku: "CLIPPER-21V",
  name: "Cordless Sheep Clipper 21V",
  productUrl: "https://supplier.example/products/clipper-21v",
  unitCostMinor: 49_000,
  stockQuantity: 25,
  currencyId: "CLP",
  observedAt,
  evidence: Object.freeze({
    id: "catalog-evidence-1",
    source: "supplier-1-catalog",
    observedAt,
    contentHash: "b".repeat(64),
  }),
});
const policy = Object.freeze({
  visualProvider: "visual-search-1",
  supplierSourceIds: Object.freeze(["supplier-1"]),
  minimumSimilarityBps: 8_000,
  maximumEvidenceAgeMs: 60 * 60_000,
  policyVersion: "catalog-acquisition-v1",
});

function createService(
  input?: Readonly<{
    upload?: SourceImageUpload | null;
    matches?: readonly PhotoSimilarityMatch[];
    offers?: readonly SupplierCatalogOffer[];
  }>,
) {
  const repository = new InMemoryAcquisitionCandidateRepository();
  let photoCalls = 0;
  let catalogCalls = 0;
  const service = new CatalogAcquisitionService(
    {
      get: () => Promise.resolve(input?.upload === undefined ? verifiedUpload : input.upload),
    },
    {
      findSimilar: () => {
        photoCalls += 1;
        return Promise.resolve(input?.matches ?? [match]);
      },
    },
    {
      search: () => {
        catalogCalls += 1;
        return Promise.resolve(input?.offers ?? [offer]);
      },
    },
    repository,
    { now: () => now },
  );
  return {
    service,
    repository,
    photoCalls: () => photoCalls,
    catalogCalls: () => catalogCalls,
  };
}

describe("CatalogAcquisitionService", () => {
  it("creates a stable review candidate from verified visual and catalog evidence", async () => {
    const first = createService();
    const firstResult = await first.service.discover({
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: "upload-1",
      policy,
    });
    const second = createService();
    const secondResult = await second.service.discover({
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: "upload-1",
      policy,
    });

    expect(firstResult).toHaveLength(1);
    expect(firstResult[0]).toMatchObject({
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: "upload-1",
      visualProvider: "visual-search-1",
      similarityBps: 8_800,
      supplierSourceId: "supplier-1",
      sku: "CLIPPER-21V",
      unitCostMinor: 49_000,
      stockQuantity: 25,
      status: "needs-review",
      requiresHumanApproval: true,
      evidenceRefs: ["visual-evidence-1", "catalog-evidence-1"],
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
    });
    expect(firstResult[0]?.id).toBe(secondResult[0]?.id);
    expect(firstResult[0]?.contentHash).toBe(secondResult[0]?.contentHash);
    await expect(
      first.repository.list({
        organizationId: "maustian",
        accountId: "plasticov",
        limit: 10,
      }),
    ).resolves.toEqual(firstResult);
  });

  it("reviews one candidate exactly once and persists reviewer metadata", async () => {
    const fixture = createService();
    const [candidate] = await fixture.service.discover({
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: "upload-1",
      policy,
    });
    expect(candidate).toBeDefined();

    const reviewed = await fixture.service.reviewCandidate({
      id: candidate!.id,
      organizationId: "maustian",
      accountId: "plasticov",
      decision: "accepted",
      reviewedBy: "reviewer-1",
      note: "Proveedor y producto confirmados.",
    });

    expect(reviewed).toMatchObject({
      status: "accepted",
      reviewedAt: now.toISOString(),
      reviewedBy: "reviewer-1",
      reviewNote: "Proveedor y producto confirmados.",
    });
    await expect(
      fixture.service.reviewCandidate({
        id: candidate!.id,
        organizationId: "maustian",
        accountId: "plasticov",
        decision: "rejected",
        reviewedBy: "reviewer-2",
      }),
    ).rejects.toThrow(/already been reviewed/);
  });

  it("isolates candidate reads by organization and account", async () => {
    const fixture = createService();
    const [candidate] = await fixture.service.discover({
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: "upload-1",
      policy,
    });

    await expect(
      fixture.service.getCandidate({
        id: candidate!.id,
        organizationId: "maustian",
        accountId: "maustian",
      }),
    ).resolves.toBeNull();
  });

  it("does not query supplier catalogs for low-similarity visual matches", async () => {
    const fixture = createService({ matches: [{ ...match, similarityBps: 7_999 }] });

    await expect(
      fixture.service.discover({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        policy,
      }),
    ).resolves.toEqual([]);
    expect(fixture.photoCalls()).toBe(1);
    expect(fixture.catalogCalls()).toBe(0);
  });

  it("blocks before provider invocation when the source image is not verified", async () => {
    const fixture = createService({
      upload: { ...verifiedUpload, status: "requested", objectUri: null, verifiedAt: null },
    });

    await expect(
      fixture.service.discover({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        policy,
      }),
    ).rejects.toThrow(/verified source image/);
    expect(fixture.photoCalls()).toBe(0);
    expect(fixture.catalogCalls()).toBe(0);
  });

  it("rejects a visual provider result from another account", async () => {
    const fixture = createService({ matches: [{ ...match, accountId: "maustian-other" }] });

    await expect(
      fixture.service.discover({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        policy,
      }),
    ).rejects.toThrow(/account is outside/);
    expect(fixture.catalogCalls()).toBe(0);
  });

  it("skips stale supplier evidence instead of estimating an offer", async () => {
    const staleObservedAt = "2026-07-28T12:00:00.000Z";
    const fixture = createService({
      offers: [
        {
          ...offer,
          observedAt: staleObservedAt,
          evidence: { ...offer.evidence, observedAt: staleObservedAt },
        },
      ],
    });

    await expect(
      fixture.service.discover({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        policy,
      }),
    ).resolves.toEqual([]);
  });

  it("rejects invalid supplier cost rather than inferring it", async () => {
    const fixture = createService({ offers: [{ ...offer, unitCostMinor: 0 }] });

    await expect(
      fixture.service.discover({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        policy,
      }),
    ).rejects.toThrow(/unitCostMinor must be a positive/);
  });

  it("rejects duplicate supplier configuration before any external call", async () => {
    const fixture = createService();

    await expect(
      fixture.service.discover({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        policy: { ...policy, supplierSourceIds: ["supplier-1", "supplier-1"] },
      }),
    ).rejects.toThrow(/configured more than once/);
    expect(fixture.photoCalls()).toBe(0);
  });
});
