BEGIN;

CREATE TABLE IF NOT EXISTS mercadolibre_oauth_states (
  state_hash text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  actor_id text NOT NULL,
  code_verifier_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS mercadolibre_oauth_states_expiry_idx
  ON mercadolibre_oauth_states(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS mercadolibre_connections (
  account_id text PRIMARY KEY REFERENCES commerce_accounts(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  mercado_libre_user_id bigint NOT NULL,
  site_id text NOT NULL,
  nickname text NOT NULL,
  status text NOT NULL CHECK (status IN ('connected', 'error', 'disconnected')),
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  token_version integer NOT NULL CHECK (token_version > 0),
  last_synced_at timestamptz,
  last_error text,
  refresh_locked_by text,
  refresh_locked_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS mercadolibre_connections_user_idx
  ON mercadolibre_connections(mercado_libre_user_id);

CREATE INDEX IF NOT EXISTS mercadolibre_connections_refresh_idx
  ON mercadolibre_connections(access_expires_at, refresh_locked_until)
  WHERE status <> 'disconnected';

CREATE TABLE IF NOT EXISTS mercadolibre_listing_snapshots (
  account_id text PRIMARY KEY REFERENCES commerce_accounts(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  mercado_libre_user_id bigint NOT NULL,
  item_ids_json jsonb NOT NULL,
  total integer NOT NULL CHECK (total >= 0),
  synced_at timestamptz NOT NULL
);

COMMIT;
