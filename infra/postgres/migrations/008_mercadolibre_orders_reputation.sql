BEGIN;

CREATE TABLE IF NOT EXISTS mercadolibre_order_snapshots (
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  seller_id text NOT NULL,
  order_id text NOT NULL,
  status text NOT NULL,
  date_created timestamptz NOT NULL,
  last_updated timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  PRIMARY KEY (account_id, order_id)
);

CREATE INDEX IF NOT EXISTS mercadolibre_order_snapshots_status_idx
  ON mercadolibre_order_snapshots(account_id, status, date_created DESC);

CREATE INDEX IF NOT EXISTS mercadolibre_order_snapshots_freshness_idx
  ON mercadolibre_order_snapshots(account_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS mercadolibre_reputation_snapshots (
  account_id text PRIMARY KEY REFERENCES commerce_accounts(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  seller_id text NOT NULL,
  site_id text NOT NULL CHECK (site_id = 'MLC'),
  observed_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  UNIQUE (organization_id, seller_id)
);

CREATE INDEX IF NOT EXISTS mercadolibre_reputation_snapshots_freshness_idx
  ON mercadolibre_reputation_snapshots(observed_at DESC);

COMMIT;
