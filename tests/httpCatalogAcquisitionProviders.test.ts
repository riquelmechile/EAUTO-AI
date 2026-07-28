import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DisabledPhotoSimilarityProvider,
  HttpPhotoSimilarityProvider,
  HttpSupplierCatalogProvider,
} from "@eauto/infrastructure";

const observedAt = "2026-07-28T15:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalog acquisition HTTP providers", () => {
  it("normalizes visual matches without accepting provider-owned scope", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          matches: [
            {
              organizationId: "attacker-org",
              accountId: "attacker-account",
              sourceImageUploadId: "attacker-upload",
              externalMatchId: "match-1",
              title: "Cordless sheep clipper",
              candidateUrl: "https://catalog.example.com/products/clipper",
              similarityBps: 9_100,
              observedAt,
              evidence: {
                id: "visual-evidence-1",
                observedAt,
                contentHash: "a".repeat(64),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new HttpPhotoSimilarityProvider({
      endpoint: "https://catalog.example.com/v1/photo-similarity",
      apiKey: "visual-secret",
      providerName: "visual-provider",
      timeoutMs: 5_000,
      maximumResponseBytes: 100_000,
    });

    const matches = await provider.findSimilar({
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: "upload-1",
      objectUri: "s3://private/upload-1.jpg",
      checksumSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      provider: "visual-provider",
    });

    expect(matches).toEqual([
      expect.objectContaining({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        provider: "visual-provider",
        externalMatchId: "match-1",
      }),
    ]);
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("https://catalog.example.com/v1/photo-similarity");
    expect(request?.[1]?.redirect).toBe("error");
    const headers = new Headers(request?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer visual-secret");
  });

  it("uses only the server allowlist for supplier catalog routes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          offers: [
            {
              supplierSourceId: "attacker-source",
              sku: "SKU-1",
              name: "Cordless sheep clipper",
              productUrl: "https://supplier.example.com/products/sku-1",
              unitCostMinor: 49_000,
              stockQuantity: 25,
              currencyId: "clp",
              observedAt,
              evidence: {
                id: "catalog-evidence-1",
                observedAt,
                contentHash: "b".repeat(64),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new HttpSupplierCatalogProvider(
      {
        "supplier-1": "https://gateway.example.com/v1/suppliers/supplier-1/search",
      },
      {
        apiKey: "supplier-secret",
        providerName: "supplier-gateway",
        timeoutMs: 5_000,
        maximumResponseBytes: 100_000,
      },
    );

    const offers = await provider.search({
      organizationId: "maustian",
      accountId: "plasticov",
      supplierSourceId: "supplier-1",
      query: "Cordless sheep clipper",
      candidateUrl: "https://catalog.example.com/products/clipper",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gateway.example.com/v1/suppliers/supplier-1/search",
    );
    expect(offers[0]).toMatchObject({
      organizationId: "maustian",
      accountId: "plasticov",
      supplierSourceId: "supplier-1",
      currencyId: "CLP",
    });
  });

  it("rejects unknown supplier sources and invalid gateway endpoints", async () => {
    const provider = new HttpSupplierCatalogProvider(
      { "supplier-1": "https://gateway.example.com/search" },
      {
        apiKey: "supplier-secret",
        providerName: "supplier-gateway",
        timeoutMs: 5_000,
        maximumResponseBytes: 100_000,
      },
    );
    await expect(
      provider.search({
        organizationId: "maustian",
        accountId: "plasticov",
        supplierSourceId: "supplier-not-allowed",
        query: "clipper",
        candidateUrl: "https://catalog.example.com/products/clipper",
      }),
    ).rejects.toThrow(/no configured catalog route/);

    expect(
      () =>
        new HttpPhotoSimilarityProvider({
          endpoint: "https://user:secret@catalog.example.com/search",
          apiKey: "secret",
          providerName: "visual-provider",
          timeoutMs: 5_000,
          maximumResponseBytes: 100_000,
        }),
    ).toThrow(/without credentials/);
  });

  it("fails closed when the integration is disabled", async () => {
    await expect(
      new DisabledPhotoSimilarityProvider().findSimilar({
        organizationId: "maustian",
        accountId: "plasticov",
        sourceImageUploadId: "upload-1",
        objectUri: "s3://private/upload-1.jpg",
        checksumSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        provider: "visual-provider",
      }),
    ).rejects.toThrow(/not configured/);
  });
});
