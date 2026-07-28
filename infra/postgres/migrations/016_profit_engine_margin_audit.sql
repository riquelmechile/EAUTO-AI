BEGIN;

CREATE TABLE IF NOT EXISTS economic_listing_policies (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  variable_rate_bps integer,
  variable_rate_evidence_id text,
  variable_rate_evidence_source text,
  variable_rate_observed_at timestamptz,
  variable_rate_content_hash text,
  target_margin_bps integer NOT NULL CHECK (target_margin_bps BETWEEN 0 AND 10000),
  maximum_increase_bps integer NOT NULL CHECK (maximum_increase_bps BETWEEN 0 AND 10000),
  competitive_ceiling_minor bigint CHECK (competitive_ceiling_minor IS NULL OR competitive_ceiling_minor > 0),
  maximum_evidence_age_ms bigint NOT NULL CHECK (maximum_evidence_age_ms >= 0),
  policy_version text NOT NULL,
  next_audit_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, listing_id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id),
  CHECK (
    (variable_rate_bps IS NULL AND variable_rate_evidence_id IS NULL
      AND variable_rate_evidence_source IS NULL AND variable_rate_observed_at IS NULL
      AND variable_rate_content_hash IS NULL)
    OR
    (variable_rate_bps BETWEEN 0 AND 10000 AND variable_rate_evidence_id IS NOT NULL
      AND variable_rate_evidence_source IS NOT NULL AND variable_rate_observed_at IS NOT NULL
      AND variable_rate_content_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS economic_listing_policies_claim_idx
  ON economic_listing_policies(next_audit_at, lease_until, account_id, listing_id);

CREATE TABLE IF NOT EXISTS economic_cost_observations (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  cost_kind text NOT NULL CHECK (cost_kind IN (
    'product-cost','fulfillment-cost','packaging-cost','ads-cost',
    'returns-cost','discount-cost','import-cost','other-cost'
  )),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  evidence_id text NOT NULL,
  evidence_source text NOT NULL,
  observed_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, listing_id, cost_kind),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS economic_cost_observations_listing_idx
  ON economic_cost_observations(account_id, listing_id, cost_kind);

CREATE TABLE IF NOT EXISTS profitability_snapshots (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('profitable','below-floor','loss','incomplete')),
  calculated_at timestamptz NOT NULL,
  content_hash text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS profitability_snapshots_listing_idx
  ON profitability_snapshots(account_id, listing_id, calculated_at DESC);

CREATE TABLE IF NOT EXISTS repricing_proposals (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending-approval','approved','rejected','superseded')),
  current_price_minor bigint NOT NULL CHECK (current_price_minor > 0),
  proposed_price_minor bigint NOT NULL CHECK (proposed_price_minor > 0),
  policy_version text NOT NULL,
  content_hash text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS repricing_proposals_inbox_idx
  ON repricing_proposals(account_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS margin_audit_findings (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('profitable','below-floor','loss','incomplete')),
  severity text NOT NULL CHECK (severity IN ('none','warning','critical','blocked')),
  observed_at timestamptz NOT NULL,
  content_hash text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS margin_audit_findings_listing_idx
  ON margin_audit_findings(account_id, listing_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS margin_audit_findings_attention_idx
  ON margin_audit_findings(account_id, severity, observed_at DESC)
  WHERE severity <> 'none';

COMMIT;
