BEGIN;

CREATE TABLE IF NOT EXISTS source_image_uploads (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  object_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('requested', 'verified', 'expired', 'rejected')),
  expires_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_image_uploads_account_created_idx
  ON source_image_uploads(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS source_image_uploads_pending_expiry_idx
  ON source_image_uploads(expires_at)
  WHERE status = 'requested';

COMMIT;
