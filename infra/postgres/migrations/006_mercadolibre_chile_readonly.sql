BEGIN;

CREATE TABLE IF NOT EXISTS mercadolibre_oauth_states (
  state_hash text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  expires_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mercadolibre_oauth_states_expiry_idx
  ON mercadolibre_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS mercadolibre_connections (
  account_id text PRIMARY KEY REFERENCES commerce_accounts(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  seller_id text NOT NULL,
  site_id text NOT NULL CHECK (site_id = 'MLC'),
  status text NOT NULL CHECK (
    status IN ('active', 'refreshing', 'reauthorization-required', 'revoked')
  ),
  expires_at timestamptz NOT NULL,
  refresh_lease_owner text,
  refresh_lease_until timestamptz,
  last_synced_at timestamptz,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, seller_id)
);

CREATE INDEX IF NOT EXISTS mercadolibre_connections_status_expiry_idx
  ON mercadolibre_connections(status, expires_at);

CREATE INDEX IF NOT EXISTS mercadolibre_connections_refresh_lease_idx
  ON mercadolibre_connections(refresh_lease_until)
  WHERE refresh_lease_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS mercadolibre_listing_snapshots (
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  seller_id text NOT NULL,
  item_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  PRIMARY KEY (account_id, item_id)
);

CREATE INDEX IF NOT EXISTS mercadolibre_listing_snapshots_observed_idx
  ON mercadolibre_listing_snapshots(account_id, observed_at DESC);

COMMIT;
