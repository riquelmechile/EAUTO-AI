BEGIN;

CREATE TABLE IF NOT EXISTS mercadolibre_product_ads_campaign_snapshots (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  seller_id text NOT NULL,
  advertiser_id text NOT NULL,
  campaign_id text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  observed_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  PRIMARY KEY (account_id, campaign_id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE TABLE IF NOT EXISTS mercadolibre_product_ads_ad_group_snapshots (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  seller_id text NOT NULL,
  advertiser_id text NOT NULL,
  campaign_id text NOT NULL,
  ad_group_id text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  observed_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  PRIMARY KEY (account_id, ad_group_id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE TABLE IF NOT EXISTS mercadolibre_product_ads_item_snapshots (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  seller_id text NOT NULL,
  advertiser_id text NOT NULL,
  campaign_id text NOT NULL,
  ad_group_id text NOT NULL,
  item_id text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  observed_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  PRIMARY KEY (account_id, ad_group_id, item_id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE TABLE IF NOT EXISTS mercadolibre_economic_reconciliation_snapshots (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  seller_id text NOT NULL,
  advertiser_id text NOT NULL,
  item_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'aligned',
      'price-drift',
      'missing-listing',
      'missing-profitability',
      'ads-metrics-unavailable'
    )
  ),
  date_from date NOT NULL,
  date_to date NOT NULL,
  observed_at timestamptz NOT NULL,
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  PRIMARY KEY (account_id, item_id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS meli_product_ads_campaign_observed_idx
  ON mercadolibre_product_ads_campaign_snapshots(account_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS meli_product_ads_ad_group_observed_idx
  ON mercadolibre_product_ads_ad_group_snapshots(account_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS meli_product_ads_item_observed_idx
  ON mercadolibre_product_ads_item_snapshots(account_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS meli_economic_reconciliation_status_idx
  ON mercadolibre_economic_reconciliation_snapshots(account_id, status, observed_at DESC);

COMMIT;
