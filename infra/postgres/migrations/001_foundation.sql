BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commerce_accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  channel text NOT NULL,
  market text NOT NULL,
  minimum_margin_bps integer NOT NULL CHECK (minimum_margin_bps BETWEEN 0 AND 10000),
  autonomy_level text NOT NULL CHECK (autonomy_level IN ('ask','inform','autonomous')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_objectives (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  title text NOT NULL,
  success_metric text NOT NULL,
  target_value numeric NOT NULL,
  deadline timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active','paused','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_orders (
  id text PRIMARY KEY,
  objective_id text NOT NULL REFERENCES business_objectives(id),
  assigned_agent_id text NOT NULL,
  title text NOT NULL,
  expected_utility numeric NOT NULL,
  max_iterations integer NOT NULL CHECK (max_iterations BETWEEN 1 AND 100),
  timeout_ms integer NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 3600000),
  status text NOT NULL CHECK (status IN ('queued','running','blocked','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_actions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  status text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_actions_account_status_idx ON business_actions(account_id, status, updated_at);

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES business_actions(id),
  action_hash text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS approvals_action_idx ON approvals(action_id, approved_at DESC);

CREATE TABLE IF NOT EXISTS verifiable_receipts (
  id text PRIMARY KEY,
  receipt_type text NOT NULL,
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  action_id text NOT NULL REFERENCES business_actions(id),
  content_hash text NOT NULL,
  policy_hash text NOT NULL,
  evidence_hash text NOT NULL,
  previous_receipt_hash text,
  payload_hash text NOT NULL,
  chain_hash text NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_action_recorded_idx ON verifiable_receipts(action_id, recorded_at);

CREATE TABLE IF NOT EXISTS content_assets (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  product_id text NOT NULL,
  kind text NOT NULL,
  uri text NOT NULL,
  content_hash text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  moderation_status text NOT NULL CHECK (moderation_status IN ('pending','approved','rejected')),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS content_assets_product_idx ON content_assets(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_work_sessions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  agent_id text NOT NULL,
  work_order_id text REFERENCES work_orders(id),
  signals_hash text NOT NULL,
  stable_prompt_hash text NOT NULL,
  cache_hit_tokens bigint NOT NULL DEFAULT 0,
  cache_miss_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost_microusd bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS transactional_outbox (
  id text PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON transactional_outbox(processed_at, available_at, created_at);

COMMIT;
