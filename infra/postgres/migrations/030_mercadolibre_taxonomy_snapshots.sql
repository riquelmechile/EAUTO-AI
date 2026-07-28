BEGIN;

CREATE TABLE IF NOT EXISTS mercadolibre_taxonomy_snapshots (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  category_id text NOT NULL CHECK (category_id ~ '^MLC[0-9]+$'),
  snapshot_kind text NOT NULL CHECK (snapshot_kind IN ('category', 'attributes')),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id, category_id, snapshot_kind, source_hash),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id),
  CHECK (
    (snapshot_kind = 'category' AND payload_json ->> 'id' = category_id)
    OR
    (snapshot_kind = 'attributes' AND payload_json ->> 'categoryId' = category_id)
  ),
  CHECK (
    payload_json #>> '{evidence,sourceHash}' IS NOT NULL
    AND payload_json #>> '{evidence,sourceHash}' = source_hash
  ),
  CHECK (payload_json #>> '{evidence,observedAt}' IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS mercadolibre_taxonomy_snapshots_latest_idx
  ON mercadolibre_taxonomy_snapshots(
    organization_id,
    account_id,
    category_id,
    snapshot_kind,
    observed_at DESC,
    created_at DESC,
    id DESC
  );

COMMIT;
