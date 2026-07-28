import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  MercadoLibreProductAdsService,
  type MercadoLibreProductAdsAdvertiser,
  type MercadoLibreProductAdsReader,
} from "@eauto/application";
import type {
  MercadoLibreListingSnapshot,
  MercadoLibreProductAdsMetrics,
  ProfitabilitySnapshot,
} from "@eauto/domain";
import { InMemoryMercadoLibreProductAdsRepository } from "../packages/infrastructure/src/mercadoLibreProductAdsRepositories.js";

const metrics: MercadoLibreProductAdsMetrics = Object.freeze({
  clicks: 10,
  prints: 1_000,
  costMinor: 2_000,
  cpcMinor: 200,
  directAmountMinor: 8_000,
  indirectAmountMinor: 2_000,
  totalAmountMinor: 10_000,
  directUnitsQuantity: 2,
  indirectUnitsQuantity: 1,
  unitsQuantity: 3,
  directItemsQuantity: 1,
  indirectItemsQuantity: 1,
  advertisingItemsQuantity: 1,
  organicUnitsQuantity: 4,
  organicAmountMinor: 20_000,
  organicItemsQuantity: 2,
  ctr: 1,
  cvr: 30,
  acos: 20,
  tacos: 6.67,
  roas: 5,
  sov: 42,
});

const listing: MercadoLibreListingSnapshot = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  sellerId: "123456789",
  itemId: "MLC123",
  title: "Producto",
  status: "active",
  priceMinor: 10_000,
  currencyId: "CLP",
  availableQuantity: 5,
  soldQuantity: 1,
  observedAt: "2026-07-28T10:00:00.000Z",
  sourceHash: "a".repeat(64),
});

function profitability(salePriceMinor: number): ProfitabilitySnapshot {
  const fixedCostsMinor = 5_000;
  const variableRateBps = 1_600;
  const variableCostsMinor = Math.round((salePriceMinor * variableRateBps) / 10_000);
  const totalCostsMinor = fixedCostsMinor + variableCostsMinor;
  const netProfitMinor = salePriceMinor - totalCostsMinor;
  return Object.freeze({
    status: "profitable",
    accountId: "plasticov",
    listingId: "MLC123",
    currency: "CLP",
    salePriceMinor,
    quantity: 1,
    minimumMarginBps: 3_500,
    variableRateBps,
    grossRevenueMinor: salePriceMinor,
    fixedCostsMinor,
    variableCostsMinor,
    totalCostsMinor,
    netProfitMinor,
    marginBps: Math.trunc((netProfitMinor * 10_000) / salePriceMinor),
    evidenceRefs: Object.freeze(["profit-v1"]),
    calculatedAt: "2026-07-28T10:00:00.000Z",
  });
}

function createService(options?: {
  advertisers?: readonly MercadoLibreProductAdsAdvertiser[];
  itemMetrics?: MercadoLibreProductAdsMetrics | null;
  listingPriceMinor?: number;
  profitPriceMinor?: number;
  expectedAdvertiserIds?: Readonly<Record<string, string>>;
}) {
  const repository = new InMemoryMercadoLibreProductAdsRepository();
  repository.seedProfitability(profitability(options?.profitPriceMinor ?? 9_500));
  const advertisers: readonly MercadoLibreProductAdsAdvertiser[] =
    options?.advertisers ??
    Object.freeze([
      Object.freeze({
        advertiserId: "456",
        siteId: "MLC",
        advertiserName: "Plasticov Ads",
        accountName: "Plasticov",
      }),
    ]);
  const reader: MercadoLibreProductAdsReader = {
    listAdvertisers: vi.fn(() => Promise.resolve(advertisers)),
    read: vi.fn(() =>
      Promise.resolve({
        campaigns: Object.freeze([
          Object.freeze({
            advertiserId: "456",
            siteId: "MLC",
            campaignId: "campaign-1",
            name: "Campaign",
            status: "active",
            dateFrom: "2026-07-01",
            dateTo: "2026-07-28",
            metrics,
            sourceHash: "c".repeat(64),
          }),
        ]),
        adGroups: Object.freeze([
          Object.freeze({
            advertiserId: "456",
            siteId: "MLC",
            campaignId: "campaign-1",
            adGroupId: "group-1",
            dateFrom: "2026-07-01",
            dateTo: "2026-07-28",
            metrics,
            sourceHash: "d".repeat(64),
          }),
        ]),
        items: Object.freeze([
          Object.freeze({
            advertiserId: "456",
            siteId: "MLC",
            campaignId: "campaign-1",
            adGroupId: "group-1",
            itemId: "MLC123",
            status: "active",
            priceMinor: 10_000,
            metrics: options?.itemMetrics === undefined ? metrics : options.itemMetrics,
            dateFrom: "2026-07-01",
            dateTo: "2026-07-28",
            sourceHash: "e".repeat(64),
          }),
        ]),
      }),
    ),
  };
  const service = new MercadoLibreProductAdsService(
    { get: () => Promise.resolve({ accessToken: "token", sellerId: "123456789" }) },
    reader,
    repository,
    {
      listListingSnapshots: () =>
        Promise.resolve([
          Object.freeze({
            ...listing,
            priceMinor: options?.listingPriceMinor ?? listing.priceMinor,
          }),
        ]),
    },
    repository,
    { now: () => new Date("2026-07-28T12:00:00.000Z") },
    (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    {
      expectedAdvertiserIds: options?.expectedAdvertiserIds ?? Object.freeze({}),
      maximumRangeDays: 90,
    },
  );
  return { service, repository, reader };
}

describe("MercadoLibreProductAdsService", () => {
  it("persists campaigns, Ad Groups, item evidence and detects Profit Engine price drift", async () => {
    const { service, repository, reader } = createService();

    const result = await service.sync({
      organizationId: "maustian",
      accountId: "plasticov",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-28",
    });

    expect(result.advertiserId).toBe("456");
    expect(result.campaigns).toHaveLength(1);
    expect(result.adGroups).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.reconciliations[0]).toMatchObject({
      itemId: "MLC123",
      listingPriceMinor: 10_000,
      adsPriceMinor: 10_000,
      profitabilityPriceMinor: 9_500,
      listingToProfitabilityDriftMinor: 500,
      adsCostMinor: 2_000,
      adsRevenueMinor: 10_000,
      attribution: "direct-item-metrics",
      status: "price-drift",
    });
    expect(result.reconciliations[0]?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await repository.listCampaigns("plasticov")).toHaveLength(1);
    expect(reader.read).toHaveBeenCalledWith(
      expect.objectContaining({ advertiserId: "456", siteId: "MLC", accessToken: "token" }),
    );
  });

  it("does not allocate campaign or Ad Group cost when item metrics are unavailable", async () => {
    const { service } = createService({
      itemMetrics: null,
      listingPriceMinor: 10_000,
      profitPriceMinor: 10_000,
    });

    const result = await service.sync({
      organizationId: "maustian",
      accountId: "plasticov",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-28",
    });

    expect(result.reconciliations[0]).toMatchObject({
      adsCostMinor: null,
      adsRevenueMinor: null,
      attribution: "unavailable",
      status: "ads-metrics-unavailable",
    });
  });

  it("requires an explicit mapping when more than one MLC advertiser is visible", async () => {
    const advertisers: readonly MercadoLibreProductAdsAdvertiser[] = Object.freeze([
      Object.freeze({
        advertiserId: "456",
        siteId: "MLC",
        advertiserName: "One",
        accountName: "One",
      }),
      Object.freeze({
        advertiserId: "789",
        siteId: "MLC",
        advertiserName: "Two",
        accountName: "Two",
      }),
    ]);
    const ambiguous = createService({ advertisers });
    await expect(
      ambiguous.service.sync({
        organizationId: "maustian",
        accountId: "plasticov",
        dateFrom: "2026-07-01",
        dateTo: "2026-07-28",
      }),
    ).rejects.toThrow(/explicit account mapping/);

    const mapped = createService({ advertisers, expectedAdvertiserIds: { plasticov: "456" } });
    await expect(
      mapped.service.sync({
        organizationId: "maustian",
        accountId: "plasticov",
        dateFrom: "2026-07-01",
        dateTo: "2026-07-28",
      }),
    ).resolves.toMatchObject({ advertiserId: "456" });
  });

  it("rejects ranges longer than the configured official maximum", async () => {
    const { service, reader } = createService();
    await expect(
      service.sync({
        organizationId: "maustian",
        accountId: "plasticov",
        dateFrom: "2026-01-01",
        dateTo: "2026-07-28",
      }),
    ).rejects.toThrow(/between 1 and 90 days/);
    expect(reader.listAdvertisers).not.toHaveBeenCalled();
  });
});
