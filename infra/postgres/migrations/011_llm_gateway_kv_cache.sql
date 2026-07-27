BEGIN;

CREATE TABLE IF NOT EXISTS llm_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  agent_id text NOT NULL,
  session_id text NOT NULL REFERENCES agent_work_sessions(id),
  task_class text NOT NULL CHECK (task_class IN (
    'classification','extraction','summarization','planning','analysis','critical-review'
  )),
  provider text NOT NULL CHECK (provider = 'deepseek'),
  model text NOT NULL CHECK (model IN ('deepseek-v4-flash','deepseek-v4-pro')),
  mode text NOT NULL CHECK (mode = 'shadow'),
  status text NOT NULL CHECK (status IN ('prepared','running','completed','failed','blocked')),
  stable_prefix_hash text NOT NULL,
  full_prompt_hash text NOT NULL,
  budget_micros_usd bigint NOT NULL CHECK (budget_micros_usd >= 0),
  estimated_maximum_cost_micros_usd bigint NOT NULL CHECK (estimated_maximum_cost_micros_usd >= 0),
  actual_cost_micros_usd bigint CHECK (actual_cost_micros_usd >= 0),
  cache_hit_tokens bigint CHECK (cache_hit_tokens >= 0),
  cache_miss_tokens bigint CHECK (cache_miss_tokens >= 0),
  output_tokens bigint CHECK (output_tokens >= 0),
  cache_hit_ratio_bps integer CHECK (cache_hit_ratio_bps BETWEEN 0 AND 10000),
  provider_request_id text,
  output_hash text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS llm_runs_account_created_idx
  ON llm_runs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_runs_session_idx
  ON llm_runs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_runs_cost_idx
  ON llm_runs(organization_id, account_id, created_at, actual_cost_micros_usd)
  WHERE actual_cost_micros_usd IS NOT NULL;
CREATE INDEX IF NOT EXISTS llm_runs_prefix_idx
  ON llm_runs(stable_prefix_hash, model, created_at DESC);

COMMIT;
