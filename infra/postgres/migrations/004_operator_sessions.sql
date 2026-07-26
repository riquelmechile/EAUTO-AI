BEGIN;

CREATE TABLE IF NOT EXISTS operator_sessions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  actor_id text NOT NULL,
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_sessions_actor_idx
  ON operator_sessions(organization_id, actor_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS operator_sessions_expiry_idx
  ON operator_sessions(refresh_expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
