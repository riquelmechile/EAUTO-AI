# SDD 018 — MercadoLibre Product Ads v2 Read Plane

## Status

Accepted for code integration. Live advertiser discovery and reconciliation remain production gates tracked in issue #41.

## Context

EAUTO-AI already ingests listings, orders, questions, claims and seller reputation from MercadoLibre Chile. Product Ads remained outside the read model, so advertising spend and revenue evidence could not be compared with the listing price or the Profit Engine snapshot.

The previous consolidated Product Ads metrics resource was retired. The current integration uses advertiser discovery plus campaign, Ad Group and ad/item resources with `api-version: 2`.

## Decision

Add a dedicated read-only Product Ads subsystem for the first Plasticov rollout.

The subsystem:

1. reuses the encrypted MercadoLibre credential store and refresh lease;
2. discovers Product Ads advertisers for `product_id=PADS`;
3. accepts only site `MLC`;
4. auto-selects an advertiser only when exactly one MLC advertiser is visible;
5. otherwise requires an explicit account-to-advertiser mapping;
6. reads campaigns, Ad Group metrics and ads/items for an explicit date range;
7. limits the range to at most 90 days;
8. persists immutable source hashes and observation times;
9. compares Product Ads item price with the latest MercadoLibre listing snapshot and Profit Engine sale price;
10. stores a reconciliation report without mutating Profit Engine costs.

## Supported resources

- Advertisers: `GET /advertising/advertisers?product_id=PADS`, `api-version: 1`.
- Campaigns: `GET /advertising/MLC/advertisers/{advertiser_id}/product_ads/campaigns/search`, `api-version: 2`.
- Ad Group metrics: `GET /advertising/MLC/product_ads/campaigns/{campaign_id}/ad_groups/metrics`, `api-version: 2`.
- Ads/items: `GET /advertising/MLC/product_ads/ad_groups/{ad_group_id}/ads`, `api-version: 2`.

The HTTP reader fixes the host to `https://api.mercadolibre.com`, rejects redirects, limits response bytes, applies a timeout and fails on invalid JSON or unexpected scope.

## Economic attribution rule

Product Ads cost is associated with a listing only when MercadoLibre returns metrics directly on that item/ad record.

EAUTO-AI does **not**:

- divide campaign spend evenly across listings;
- divide Ad Group spend by impressions, clicks or units;
- infer per-unit advertising cost;
- write Product Ads cost into `ads-cost` or Profit Engine inputs automatically.

Any future allocation rule is a business policy decision and requires its own version, tests, evidence and approval.

## Reconciliation states

- `aligned`: listing, Product Ads item and Profit Engine price agree and item metrics exist;
- `price-drift`: at least one observed price differs;
- `missing-listing`: Product Ads references an item absent from the listing read model;
- `missing-profitability`: no Profit Engine snapshot exists for the item;
- `ads-metrics-unavailable`: prices align but MercadoLibre returned no direct item metrics.

Each reconciliation contains the selected date range, observed prices, direct item cost/revenue when available, attribution mode, observation time and `sourceHash`.

## Persistence

Migration `031_mercadolibre_product_ads_read_plane.sql` creates account-scoped tables for:

- campaign snapshots;
- Ad Group snapshots;
- item snapshots;
- economic reconciliation snapshots.

Replacement is transactional per account. Composite organization/account foreign keys preserve tenant isolation.

## API

Authenticated routes require normal account authorization:

- `POST /v1/integrations/mercadolibre/product-ads/sync`;
- `GET /v1/integrations/mercadolibre/product-ads/campaigns`;
- `GET /v1/integrations/mercadolibre/product-ads/ad-groups`;
- `GET /v1/integrations/mercadolibre/product-ads/items`;
- `GET /v1/integrations/mercadolibre/product-ads/reconciliations`.

Sync requires `accountId`, `dateFrom` and `dateTo`. It performs no write to MercadoLibre.

## Security invariants

- Plasticov is the only account accepted in the first rollout.
- Product Ads never routes through `ACTION_PROVIDER_ROUTES_JSON`.
- `ads.update` remains globally blocked.
- Advertiser ambiguity fails closed.
- Tokens never enter snapshots, receipts or logs.
- Direct item evidence remains separate from derived Profit Engine costs.
- The subsystem performs no external call at process startup; sync is explicit and authorized.

## Verification

- HTTP contract tests assert the exact supported resource family and API-version headers.
- Service tests cover advertiser ambiguity, direct item attribution, missing metrics and price drift.
- PostgreSQL smoke verifies migration, atomic replacement, tenant isolation and latest Profit Engine snapshot lookup.
- Production doctor verifies required files, limits and Plasticov-only configuration.

## Live gate

Before declaring Product Ads operational:

- authorize Plasticov with Product Ads access;
- run advertiser discovery and persist an explicit mapping if more than one MLC advertiser appears;
- compare campaign, Ad Group and item metrics with MercadoLibre for five consecutive business days;
- document unexplained drift;
- define a separate business policy before feeding any allocated advertising cost into unit economics.
