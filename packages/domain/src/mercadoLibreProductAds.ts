export type MercadoLibreProductAdsMetrics = Readonly<{
  clicks: number;
  prints: number;
  costMinor: number;
  cpcMinor: number;
  directAmountMinor: number;
  indirectAmountMinor: number;
  totalAmountMinor: number;
  directUnitsQuantity: number;
  indirectUnitsQuantity: number;
  unitsQuantity: number;
  directItemsQuantity: number;
  indirectItemsQuantity: number;
  advertisingItemsQuantity: number;
  organicUnitsQuantity: number;
  organicAmountMinor: number;
  organicItemsQuantity: number;
  ctr: number;
  cvr: number;
  acos: number;
  tacos: number;
  roas: number;
  sov: number;
}>;

export type MercadoLibreProductAdsCampaignSnapshot = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  advertiserId: string;
  siteId: "MLC";
  campaignId: string;
  name: string;
  status: string;
  strategy?: string;
  dailyBudgetMinor?: number;
  roasTarget?: number;
  dateFrom: string;
  dateTo: string;
  metrics: MercadoLibreProductAdsMetrics;
  observedAt: string;
  sourceHash: string;
}>;

export type MercadoLibreProductAdsAdGroupSnapshot = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  advertiserId: string;
  siteId: "MLC";
  campaignId: string;
  adGroupId: string;
  externalId?: string;
  type?: string;
  status?: string;
  dateFrom: string;
  dateTo: string;
  metrics: MercadoLibreProductAdsMetrics;
  observedAt: string;
  sourceHash: string;
}>;

export type MercadoLibreProductAdsItemSnapshot = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  advertiserId: string;
  siteId: "MLC";
  campaignId: string;
  adGroupId: string;
  itemId: string;
  title?: string;
  status: string;
  priceMinor?: number;
  metrics: MercadoLibreProductAdsMetrics | null;
  dateFrom: string;
  dateTo: string;
  observedAt: string;
  sourceHash: string;
}>;

export type MercadoLibreEconomicReconciliationStatus =
  | "aligned"
  | "price-drift"
  | "missing-listing"
  | "missing-profitability"
  | "ads-metrics-unavailable";

/**
 * Evidence-only reconciliation. Product Ads cost is preserved for the selected
 * date range and is never converted into a per-unit Profit Engine cost without
 * an explicit business attribution policy.
 */
export type MercadoLibreEconomicReconciliationSnapshot = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  advertiserId: string;
  itemId: string;
  dateFrom: string;
  dateTo: string;
  listingPriceMinor: number | null;
  adsPriceMinor: number | null;
  profitabilityPriceMinor: number | null;
  listingToProfitabilityDriftMinor: number | null;
  listingToAdsDriftMinor: number | null;
  adsCostMinor: number | null;
  adsRevenueMinor: number | null;
  attribution: "direct-item-metrics" | "unavailable";
  status: MercadoLibreEconomicReconciliationStatus;
  observedAt: string;
  sourceHash: string;
}>;
