CREATE TABLE IF NOT EXISTS product_taxonomy_resolutions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES commerce_accounts(id) ON DELETE CASCADE,
  identification_id text NOT NULL REFERENCES product_identification_results(id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('resolved-pending-review', 'no-prediction')),
  proposed_category_id text,
  policy_version text NOT NULL,
  evaluated_at timestamptz NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id, id)
);

CREATE INDEX IF NOT EXISTS product_taxonomy_resolutions_account_time_idx
  ON product_taxonomy_resolutions (organization_id, account_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS product_taxonomy_resolutions_product_idx
  ON product_taxonomy_resolutions (organization_id, account_id, product_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS product_taxonomy_resolutions_identification_idx
  ON product_taxonomy_resolutions (organization_id, account_id, identification_id);

CREATE TABLE IF NOT EXISTS product_taxonomy_reviews (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES commerce_accounts(id) ON DELETE CASCADE,
  resolution_id text NOT NULL REFERENCES product_taxonomy_resolutions(id) ON DELETE RESTRICT,
  identification_id text NOT NULL REFERENCES product_identification_results(id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('confirmed', 'rejected')),
  category_id text,
  reviewer_id text NOT NULL,
  reason text,
  policy_version text NOT NULL,
  decided_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resolution_id),
  CHECK (
    (decision = 'confirmed' AND category_id IS NOT NULL)
    OR (decision = 'rejected' AND category_id IS NULL AND reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS product_taxonomy_reviews_account_time_idx
  ON product_taxonomy_reviews (organization_id, account_id, decided_at DESC);
