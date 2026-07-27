BEGIN;

CREATE TABLE IF NOT EXISTS agent_preflight_reports (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  agent_id text NOT NULL,
  requested_action text NOT NULL,
  status text NOT NULL CHECK (status IN ('allow','ask','deny')),
  contract_hash text NOT NULL,
  generated_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_preflight_account_idx
  ON agent_preflight_reports(account_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS agent_work_sessions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  objective_id text NOT NULL,
  agent_id text NOT NULL,
  parent_session_id text REFERENCES agent_work_sessions(id),
  delegation_depth integer NOT NULL CHECK (delegation_depth BETWEEN 0 AND 2),
  status text NOT NULL CHECK (status IN (
    'queued','running','waiting-evidence','waiting-approval','completed','failed','cancelled'
  )),
  requested_action text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  budget_minor_clp bigint NOT NULL CHECK (budget_minor_clp >= 0),
  spent_minor_clp bigint NOT NULL CHECK (spent_minor_clp >= 0),
  deadline_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL
);

-- The foundation migration already created an earlier agent_work_sessions table.
-- Migration 013 performs the in-place schema repair and creates the scoped indexes after
-- safely backfilling any legacy rows. Do not reference the new columns here because they
-- may not exist yet on an upgraded database.


COMMIT;
