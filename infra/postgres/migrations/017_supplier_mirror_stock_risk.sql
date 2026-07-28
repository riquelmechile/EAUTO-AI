BEGIN;

CREATE TABLE IF NOT EXISTS supplier_sources (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('online','manual','own','unverified')),
  base_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id, id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE TABLE IF NOT EXISTS supplier_products (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  supplier_source_id text NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  previous_stock_qty bigint NOT NULL DEFAULT 0 CHECK (previous_stock_qty >= 0),
  stock_qty bigint NOT NULL CHECK (stock_qty >= 0),
  previous_unit_cost_minor bigint CHECK (
    previous_unit_cost_minor IS NULL OR previous_unit_cost_minor >= 0
  ),
  unit_cost_minor bigint CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0),
  sync_succeeded boolean NOT NULL,
  consecutive_successful_syncs integer NOT NULL DEFAULT 0 CHECK (
    consecutive_successful_syncs >= 0
  ),
  observed_at timestamptz NOT NULL,
  evidence_id text NOT NULL,
  evidence_source text NOT NULL,
  evidence_content_hash text NOT NULL,
  current_content_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_source_id, sku),
  UNIQUE (organization_id, account_id, supplier_source_id, sku),
  FOREIGN KEY (organization_id, account_id, supplier_source_id)
    REFERENCES supplier_sources(organization_id, account_id, id)
);

CREATE TABLE IF NOT EXISTS supplier_product_observations (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  supplier_source_id text NOT NULL,
  sku text NOT NULL,
  observed_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_source_id, sku, content_hash),
  FOREIGN KEY (organization_id, account_id, supplier_source_id)
    REFERENCES supplier_sources(organization_id, account_id, id)
);

CREATE INDEX IF NOT EXISTS supplier_product_observations_history_idx
  ON supplier_product_observations(supplier_source_id, sku, observed_at DESC);

CREATE TABLE IF NOT EXISTS supplier_listing_links (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  supplier_source_id text NOT NULL,
  sku text NOT NULL,
  listing_id text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  recovery_stock_threshold bigint NOT NULL DEFAULT 2 CHECK (recovery_stock_threshold >= 0),
  recovery_consecutive_syncs integer NOT NULL DEFAULT 2 CHECK (recovery_consecutive_syncs > 0),
  recovery_confirmation_count integer NOT NULL DEFAULT 0 CHECK (
    recovery_confirmation_count >= 0
  ),
  cost_change_alert_bps integer NOT NULL DEFAULT 500 CHECK (
    cost_change_alert_bps BETWEEN 0 AND 10000
  ),
  maximum_evidence_age_ms bigint NOT NULL DEFAULT 86400000 CHECK (
    maximum_evidence_age_ms >= 0
  ),
  policy_version text NOT NULL,
  next_audit_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, listing_id, supplier_source_id, sku),
  FOREIGN KEY (organization_id, account_id, supplier_source_id, sku)
    REFERENCES supplier_products(organization_id, account_id, supplier_source_id, sku),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS supplier_listing_links_claim_idx
  ON supplier_listing_links(next_audit_at, lease_until, account_id, listing_id)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS supplier_stock_assessments (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  supplier_source_id text NOT NULL,
  listing_id text NOT NULL,
  policy_version text NOT NULL,
  evaluated_at timestamptz NOT NULL,
  content_hash text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id, supplier_source_id)
    REFERENCES supplier_sources(organization_id, account_id, id)
);

CREATE INDEX IF NOT EXISTS supplier_stock_assessments_listing_idx
  ON supplier_stock_assessments(account_id, listing_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS supplier_availability_proposals (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  supplier_source_id text NOT NULL,
  listing_id text NOT NULL,
  proposal_kind text NOT NULL CHECK (proposal_kind IN ('listing.pause','listing.reactivate')),
  status text NOT NULL DEFAULT 'pending-approval' CHECK (
    status IN ('pending-approval','approved','rejected','superseded')
  ),
  policy_version text NOT NULL,
  content_hash text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id, supplier_source_id)
    REFERENCES supplier_sources(organization_id, account_id, id)
);

CREATE INDEX IF NOT EXISTS supplier_availability_proposals_inbox_idx
  ON supplier_availability_proposals(account_id, status, created_at DESC);

COMMIT;
