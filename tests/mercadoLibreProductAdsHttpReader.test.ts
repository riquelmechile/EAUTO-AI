import { afterEach, describe, expect, it, vi } from "vitest";
import { MercadoLibreProductAdsHttpReader } from "../packages/infrastructure/src/mercadoLibreProductAdsHttpReader.js";

const metricPayload = Object.freeze({
  clicks: 10,
  prints: 1_000,
  cost: 2_000,
  cpc: 200,
  direct_amount: 8_000,
  indirect_amount: 2_000,
  total_amount: 10_000,
  direct_units_quantity: 2,
  indirect_units_quantity: 1,
  units_quantity: 3,
  direct_items_quantity: 1,
  indirect_items_quantity: 1,
  advertising_items_quantity: 1,
  organic_units_quantity: 4,
  organic_amount: 20_000,
  organic_items_quantity: 2,
  ctr: 1,
  cvr: 30,
  acos: 20,
  tacos: 6.67,
  roas: 5,
  sov: 42,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MercadoLibreProductAdsHttpReader", () => {
  it("uses advertiser discovery v1 and supported Product Ads v2 endpoints", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            advertiser_id: 456,
            site_id: "MLC",
            advertiser_name: "Plasticov Ads",
            account_name: "Plasticov",
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: 11,
              name: "Campaign",
              status: "active",
              strategy: "profitability",
              daily_budget: 5_000,
              roas_target: 4,
              metrics: metricPayload,
            },
          ],
          paging: { total: 1 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            ad_group_id: 22,
            ad_group_external_id: "MLC123",
            status: "active",
            type: "listing",
            metrics: metricPayload,
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              item_id: "MLC123",
              title: "Producto",
              status: "active",
              price: 10_000,
              metrics: metricPayload,
            },
          ],
          paging: { total: 1 },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const reader = new MercadoLibreProductAdsHttpReader({
      apiBaseUrl: "https://api.mercadolibre.com",
      timeoutMs: 5_000,
      maximumResponseBytes: 100_000,
      maximumScanPages: 10,
    });

    const advertisers = await reader.listAdvertisers("token");
    const result = await reader.read({
      advertiserId: advertisers[0]?.advertiserId ?? "",
      siteId: "MLC",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-28",
      accessToken: "token",
    });

    expect(advertisers).toEqual([
      {
        advertiserId: "456",
        siteId: "MLC",
        advertiserName: "Plasticov Ads",
        accountName: "Plasticov",
      },
    ]);
    expect(result.campaigns[0]).toMatchObject({
      campaignId: "11",
      dailyBudgetMinor: 5_000,
      metrics: { costMinor: 2_000, totalAmountMinor: 10_000 },
    });
    expect(result.adGroups[0]).toMatchObject({
      adGroupId: "22",
      externalId: "MLC123",
    });
    expect(result.items[0]).toMatchObject({
      itemId: "MLC123",
      priceMinor: 10_000,
      metrics: { costMinor: 2_000, totalAmountMinor: 10_000 },
    });

    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(4);
    expect(new URL(calls[0]?.[0] as URL).pathname).toBe("/advertising/advertisers");
    expect(new Headers(calls[0]?.[1]?.headers).get("api-version")).toBe("1");
    for (const call of calls.slice(1)) {
      expect(new Headers(call[1]?.headers).get("api-version")).toBe("2");
      expect(String(call[0])).not.toContain("/advertising/product_ads/metrics");
    }
    expect(String(calls[1]?.[0])).toContain(
      "/advertising/MLC/advertisers/456/product_ads/campaigns/search",
    );
    expect(String(calls[2]?.[0])).toContain(
      "/advertising/MLC/product_ads/campaigns/11/ad_groups/metrics",
    );
    expect(String(calls[3]?.[0])).toContain("/advertising/MLC/product_ads/ad_groups/22/ads");
  });

  it("fails closed on a non-official API host", () => {
    expect(
      () =>
        new MercadoLibreProductAdsHttpReader({
          apiBaseUrl: "https://proxy.example.com",
          timeoutMs: 5_000,
          maximumResponseBytes: 100_000,
          maximumScanPages: 10,
        }),
    ).toThrow(/api\.mercadolibre\.com/);
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
