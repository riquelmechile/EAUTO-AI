import type {
  MercadoLibreEconomicReconciliationSnapshot,
  MercadoLibreListingSnapshot,
  MercadoLibreProductAdsAdGroupSnapshot,
  MercadoLibreProductAdsCampaignSnapshot,
  MercadoLibreProductAdsItemSnapshot,
  MercadoLibreProductAdsMetrics,
  ProfitabilitySnapshot,
} from "@eauto/domain";

export type MercadoLibreProductAdsAdvertiser = Readonly<{
  advertiserId: string;
  siteId: string;
  advertiserName: string;
  accountName: string;
}>;

export type MercadoLibreRemoteProductAdsCampaign = Readonly<{
  advertiserId: string;
  siteId: string;
  campaignId: string;
  name: string;
  status: string;
  strategy?: string;
  dailyBudgetMinor?: number;
  roasTarget?: number;
  dateFrom: string;
  dateTo: string;
  metrics: MercadoLibreProductAdsMetrics;
  sourceHash: string;
}>;

export type MercadoLibreRemoteProductAdsAdGroup = Readonly<{
  advertiserId: string;
  siteId: string;
  campaignId: string;
  adGroupId: string;
  externalId?: string;
  type?: string;
  status?: string;
  dateFrom: string;
  dateTo: string;
  metrics: MercadoLibreProductAdsMetrics;
  sourceHash: string;
}>;

export type MercadoLibreRemoteProductAdsItem = Readonly<{
  advertiserId: string;
  siteId: string;
  campaignId: string;
  adGroupId: string;
  itemId: string;
  title?: string;
  status: string;
  priceMinor?: number;
  metrics: MercadoLibreProductAdsMetrics | null;
  dateFrom: string;
  dateTo: string;
  sourceHash: string;
}>;

export interface MercadoLibreProductAdsReader {
  listAdvertisers(accessToken: string): Promise<readonly MercadoLibreProductAdsAdvertiser[]>;
  read(input: {
    advertiserId: string;
    siteId: "MLC";
    dateFrom: string;
    dateTo: string;
    accessToken: string;
  }): Promise<{
    campaigns: readonly MercadoLibreRemoteProductAdsCampaign[];
    adGroups: readonly MercadoLibreRemoteProductAdsAdGroup[];
    items: readonly MercadoLibreRemoteProductAdsItem[];
  }>;
}

export interface MercadoLibreProductAdsCredentialProvider {
  get(accountId: string): Promise<{ accessToken: string; sellerId: string }>;
}

export interface MercadoLibreProductAdsRepository {
  replace(input: {
    accountId: string;
    campaigns: readonly MercadoLibreProductAdsCampaignSnapshot[];
    adGroups: readonly MercadoLibreProductAdsAdGroupSnapshot[];
    items: readonly MercadoLibreProductAdsItemSnapshot[];
    reconciliations: readonly MercadoLibreEconomicReconciliationSnapshot[];
  }): Promise<void>;
  listCampaigns(accountId: string): Promise<readonly MercadoLibreProductAdsCampaignSnapshot[]>;
  listAdGroups(accountId: string): Promise<readonly MercadoLibreProductAdsAdGroupSnapshot[]>;
  listItems(accountId: string): Promise<readonly MercadoLibreProductAdsItemSnapshot[]>;
  listReconciliations(
    accountId: string,
  ): Promise<readonly MercadoLibreEconomicReconciliationSnapshot[]>;
}

export interface MercadoLibreProductAdsListingReader {
  listListingSnapshots(accountId: string): Promise<readonly MercadoLibreListingSnapshot[]>;
}

export interface LatestProfitabilitySnapshotReader {
  readLatest(accountId: string, listingId: string): Promise<ProfitabilitySnapshot | null>;
}

export type MercadoLibreProductAdsServiceConfig = Readonly<{
  expectedAdvertiserIds: Readonly<Record<string, string>>;
  maximumRangeDays: number;
}>;

export class MercadoLibreProductAdsService {
  constructor(
    private readonly credentials: MercadoLibreProductAdsCredentialProvider,
    private readonly reader: MercadoLibreProductAdsReader,
    private readonly repository: MercadoLibreProductAdsRepository,
    private readonly listings: MercadoLibreProductAdsListingReader,
    private readonly profitability: LatestProfitabilitySnapshotReader,
    private readonly clock: { now(): Date },
    private readonly hashCanonical: (value: unknown) => string,
    private readonly config: MercadoLibreProductAdsServiceConfig,
  ) {
    if (!Number.isSafeInteger(config.maximumRangeDays) || config.maximumRangeDays < 1) {
      throw new Error("Product Ads maximum range must be a positive safe integer.");
    }
  }

  async sync(input: {
    organizationId: string;
    accountId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<{
    advertiserId: string;
    campaigns: readonly MercadoLibreProductAdsCampaignSnapshot[];
    adGroups: readonly MercadoLibreProductAdsAdGroupSnapshot[];
    items: readonly MercadoLibreProductAdsItemSnapshot[];
    reconciliations: readonly MercadoLibreEconomicReconciliationSnapshot[];
    observedAt: string;
  }> {
    validateRange(input.dateFrom, input.dateTo, this.config.maximumRangeDays);
    const credential = await this.credentials.get(input.accountId);
    const advertisers = await this.reader.listAdvertisers(credential.accessToken);
    const advertiser = selectAdvertiser(
      advertisers,
      this.config.expectedAdvertiserIds[input.accountId],
    );
    const remote = await this.reader.read({
      advertiserId: advertiser.advertiserId,
      siteId: "MLC",
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      accessToken: credential.accessToken,
    });
    const observedAt = this.clock.now().toISOString();
    const base = Object.freeze({
      organizationId: input.organizationId,
      accountId: input.accountId,
      sellerId: credential.sellerId,
      advertiserId: advertiser.advertiserId,
      siteId: "MLC" as const,
      observedAt,
    });
    const campaigns = Object.freeze(
      remote.campaigns.map((campaign) => {
        assertRemoteScope(campaign, advertiser.advertiserId);
        return Object.freeze({ ...base, ...campaign, advertiserId: advertiser.advertiserId, siteId: "MLC" as const });
      }),
    );
    const adGroups = Object.freeze(
      remote.adGroups.map((adGroup) => {
        assertRemoteScope(adGroup, advertiser.advertiserId);
        return Object.freeze({ ...base, ...adGroup, advertiserId: advertiser.advertiserId, siteId: "MLC" as const });
      }),
    );
    const items = Object.freeze(
      remote.items.map((item) => {
        assertRemoteScope(item, advertiser.advertiserId);
        return Object.freeze({ ...base, ...item, advertiserId: advertiser.advertiserId, siteId: "MLC" as const });
      }),
    );
    const reconciliations = await this.reconcile({
      organizationId: input.organizationId,
      accountId: input.accountId,
      sellerId: credential.sellerId,
      advertiserId: advertiser.advertiserId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      observedAt,
      items,
    });
    await this.repository.replace({
      accountId: input.accountId,
      campaigns,
      adGroups,
      items,
      reconciliations,
    });
    return {
      advertiserId: advertiser.advertiserId,
      campaigns,
      adGroups,
      items,
      reconciliations,
      observedAt,
    };
  }

  listCampaigns(accountId: string): Promise<readonly MercadoLibreProductAdsCampaignSnapshot[]> {
    return this.repository.listCampaigns(accountId);
  }

  listAdGroups(accountId: string): Promise<readonly MercadoLibreProductAdsAdGroupSnapshot[]> {
    return this.repository.listAdGroups(accountId);
  }

  listItems(accountId: string): Promise<readonly MercadoLibreProductAdsItemSnapshot[]> {
    return this.repository.listItems(accountId);
  }

  listReconciliations(
    accountId: string,
  ): Promise<readonly MercadoLibreEconomicReconciliationSnapshot[]> {
    return this.repository.listReconciliations(accountId);
  }

  private async reconcile(input: {
    organizationId: string;
    accountId: string;
    sellerId: string;
    advertiserId: string;
    dateFrom: string;
    dateTo: string;
    observedAt: string;
    items: readonly MercadoLibreProductAdsItemSnapshot[];
  }): Promise<readonly MercadoLibreEconomicReconciliationSnapshot[]> {
    const listings = await this.listings.listListingSnapshots(input.accountId);
    const listingById = new Map(listings.map((listing) => [listing.itemId, listing]));
    const reconciliations: MercadoLibreEconomicReconciliationSnapshot[] = [];
    for (const item of input.items) {
      const listing = listingById.get(item.itemId) ?? null;
      const profit = await this.profitability.readLatest(input.accountId, item.itemId);
      const profitabilityPriceMinor = profit?.salePriceMinor ?? null;
      const listingToProfitabilityDriftMinor =
        listing && profitabilityPriceMinor !== null
          ? listing.priceMinor - profitabilityPriceMinor
          : null;
      const listingToAdsDriftMinor =
        listing && item.priceMinor !== undefined ? listing.priceMinor - item.priceMinor : null;
      const attribution = item.metrics ? ("direct-item-metrics" as const) : ("unavailable" as const);
      const status = !listing
        ? ("missing-listing" as const)
        : !profit
          ? ("missing-profitability" as const)
          : listingToProfitabilityDriftMinor !== 0 ||
              (listingToAdsDriftMinor !== null && listingToAdsDriftMinor !== 0)
            ? ("price-drift" as const)
            : !item.metrics
              ? ("ads-metrics-unavailable" as const)
              : ("aligned" as const);
      const unsigned = {
        organizationId: input.organizationId,
        accountId: input.accountId,
        sellerId: input.sellerId,
        advertiserId: input.advertiserId,
        itemId: item.itemId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        listingPriceMinor: listing?.priceMinor ?? null,
        adsPriceMinor: item.priceMinor ?? null,
        profitabilityPriceMinor,
        listingToProfitabilityDriftMinor,
        listingToAdsDriftMinor,
        adsCostMinor: item.metrics?.costMinor ?? null,
        adsRevenueMinor: item.metrics?.totalAmountMinor ?? null,
        attribution,
        status,
        observedAt: input.observedAt,
      };
      reconciliations.push(
        Object.freeze({ ...unsigned, sourceHash: this.hashCanonical(unsigned) }),
      );
    }
    return Object.freeze(reconciliations);
  }
}

function selectAdvertiser(
  advertisers: readonly MercadoLibreProductAdsAdvertiser[],
  expectedAdvertiserId: string | undefined,
): MercadoLibreProductAdsAdvertiser {
  const chile = advertisers.filter((advertiser) => advertiser.siteId === "MLC");
  if (expectedAdvertiserId) {
    const expected = chile.find((advertiser) => advertiser.advertiserId === expectedAdvertiserId);
    if (!expected) {
      throw new Error(
        `Configured Product Ads advertiser ${expectedAdvertiserId} is not available for MLC.`,
      );
    }
    return expected;
  }
  if (chile.length !== 1) {
    throw new Error(
      `Product Ads requires exactly one MLC advertiser or an explicit account mapping; received ${chile.length}.`,
    );
  }
  return chile[0] as MercadoLibreProductAdsAdvertiser;
}

function assertRemoteScope(
  value: { advertiserId: string; siteId: string },
  advertiserId: string,
): void {
  if (value.siteId !== "MLC" || value.advertiserId !== advertiserId) {
    throw new Error("Product Ads reader returned evidence outside the selected MLC advertiser.");
  }
}

function validateRange(dateFrom: string, dateTo: string, maximumRangeDays: number): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw new Error("Product Ads date range must use YYYY-MM-DD.");
  }
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (Number.isNaN(days) || days < 1 || days > maximumRangeDays) {
    throw new Error(`Product Ads range must contain between 1 and ${maximumRangeDays} days.`);
  }
}
