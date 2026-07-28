BEGIN;

CREATE TABLE IF NOT EXISTS supplier_sources (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('online','manual','own','unverified')),
  active boolean NOT NULL DEFAULT true,
  maximum_evidence_age_ms bigint NOT NULL CHECK (maximum_evidence_age_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id, id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS supplier_sources_account_active_idx
  ON supplier_sources(account_id, active, source_type);

CREATE TABLE IF NOT EXISTS supplier_listing_links (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  supplier_source_id text NOT NULL,
  source_sku text,
  recovery_stock_threshold integer NOT NULL DEFAULT 2 CHECK (recovery_stock_threshold >= 0),
  recovery_consecutive_syncs integer NOT NULL DEFAULT 2 CHECK (recovery_consecutive_syncs > 0),
  cost_change_alert_bps integer NOT NULL DEFAULT 500 CHECK (cost_change_alert_bps BETWEEN 0 AND 10000),
  policy_version text NOT NULL,
  previous_stock integer NOT NULL DEFAULT 0 CHECK (previous_stock >= 0),
  current_stock integer NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  consecutive_successful_syncs integer NOT NULL DEFAULT 0 CHECK (consecutive_successful_syncs >= 0),
  sync_succeeded boolean NOT NULL DEFAULT false,
  previous_unit_cost_minor bigint CHECK (previous_unit_cost_minor IS NULL OR previous_unit_cost_minor >= 0),
  current_unit_cost_minor bigint CHECK (current_unit_cost_minor IS NULL OR current_unit_cost_minor >= 0),
  stock_evidence_id text,
  stock_evidence_source text,
  stock_observed_at timestamptz,
  stock_content_hash text,
  cost_evidence_id text,
  cost_evidence_source text,
  cost_observed_at timestamptz,
  cost_content_hash text,
  next_evaluation_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, listing_id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id),
  FOREIGN KEY (organization_id, account_id, supplier_source_id)
    REFERENCES supplier_sources(organization_id, account_id, id),
  CHECK (
    (current_unit_cost_minor IS NULL AND cost_evidence_id IS NULL AND cost_evidence_source IS NULL
      AND cost_observed_at IS NULL AND cost_content_hash IS NULL)
    OR
    (current_unit_cost_minor IS NOT NULL AND cost_evidence_id IS NOT NULL
      AND cost_evidence_source IS NOT NULL AND cost_observed_at IS NOT NULL
      AND cost_content_hash IS NOT NULL)
  ),
  CHECK (
    (stock_evidence_id IS NULL AND stock_evidence_source IS NULL
      AND stock_observed_at IS NULL AND stock_content_hash IS NULL)
    OR
    (stock_evidence_id IS NOT NULL AND stock_evidence_source IS NOT NULL
      AND stock_observed_at IS NOT NULL AND stock_content_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS supplier_listing_links_claim_idx
  ON supplier_listing_links(next_evaluation_at, lease_until, account_id, listing_id);
CREATE INDEX IF NOT EXISTS supplier_listing_links_source_idx
  ON supplier_listing_links(supplier_source_id, account_id, listing_id);

CREATE TABLE IF NOT EXISTS supplier_stock_observations (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  supplier_source_id text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('online','manual','own','unverified')),
  stock_quantity integer NOT NULL CHECK (stock_quantity >= 0),
  unit_cost_minor bigint CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0),
  sync_succeeded boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  content_hash text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id),
  FOREIGN KEY (organization_id, account_id, supplier_source_id)
    REFERENCES supplier_sources(organization_id, account_id, id)
);

CREATE INDEX IF NOT EXISTS supplier_stock_observations_listing_idx
  ON supplier_stock_observations(account_id, listing_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS supplier_stock_assessments (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  supplier_source_id text NOT NULL,
  evaluated_at timestamptz NOT NULL,
  content_hash text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS supplier_stock_assessments_listing_idx
  ON supplier_stock_assessments(account_id, listing_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS stock_availability_proposals (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  supplier_source_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('listing.pause','listing.reactivate')),
  status text NOT NULL CHECK (status IN ('pending-approval','approved','rejected','superseded')),
  policy_version text NOT NULL,
  content_hash text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS stock_availability_proposals_inbox_idx
  ON stock_availability_proposals(account_id, status, created_at DESC);

COMMIT;
