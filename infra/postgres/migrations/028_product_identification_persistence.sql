BEGIN;

CREATE TABLE IF NOT EXISTS product_identification_results (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  source_image_upload_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'identified-pending-confirmation',
    'ambiguous',
    'no-match',
    'duplicate-blocked',
    'incomplete'
  )),
  selected_candidate_id text,
  policy_version text NOT NULL,
  evaluated_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  fingerprint_algorithm text NOT NULL CHECK (fingerprint_algorithm = 'phash-64'),
  fingerprint_version text NOT NULL,
  fingerprint bit(64) NOT NULL,
  fingerprint_evidence_ref text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id, id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id),
  CHECK (
    (status = 'identified-pending-confirmation' AND selected_candidate_id IS NOT NULL)
    OR
    (status <> 'identified-pending-confirmation' AND selected_candidate_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS product_identification_results_source_idx
  ON product_identification_results(
    organization_id,
    account_id,
    source_image_upload_id,
    evaluated_at DESC
  );

CREATE INDEX IF NOT EXISTS product_identification_results_status_idx
  ON product_identification_results(account_id, status, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS product_identification_reviews (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  identification_id text NOT NULL UNIQUE,
  source_image_upload_id text NOT NULL,
  candidate_id text NOT NULL,
  product_id text,
  decision text NOT NULL CHECK (decision IN ('confirmed','rejected')),
  reviewer_id text NOT NULL,
  reason text,
  policy_version text NOT NULL,
  decided_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id, identification_id)
    REFERENCES product_identification_results(organization_id, account_id, id),
  CHECK (
    (decision = 'confirmed' AND product_id IS NOT NULL)
    OR
    (decision = 'rejected' AND product_id IS NULL AND reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS product_identification_reviews_account_idx
  ON product_identification_reviews(account_id, decision, decided_at DESC);

CREATE TABLE IF NOT EXISTS product_visual_fingerprints (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  product_id text NOT NULL,
  identification_id text NOT NULL,
  source_image_upload_id text NOT NULL,
  algorithm text NOT NULL CHECK (algorithm = 'phash-64'),
  version text NOT NULL,
  fingerprint bit(64) NOT NULL,
  evidence_ref text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, product_id, algorithm, version),
  FOREIGN KEY (organization_id, account_id, identification_id)
    REFERENCES product_identification_results(organization_id, account_id, id)
);

CREATE INDEX IF NOT EXISTS product_visual_fingerprints_search_idx
  ON product_visual_fingerprints(account_id, algorithm, version);

COMMIT;
