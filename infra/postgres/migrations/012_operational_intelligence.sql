BEGIN;

CREATE TABLE IF NOT EXISTS operational_evidence_packs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  subject text NOT NULL CHECK (subject IN (
    'catalog','customer','commercial','economic','reputation','content','system'
  )),
  purpose text NOT NULL,
  complete boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_evidence_packs_account_idx
  ON operational_evidence_packs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operational_evidence_packs_expiry_idx
  ON operational_evidence_packs(expires_at);

CREATE TABLE IF NOT EXISTS consultative_memory (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text REFERENCES commerce_accounts(id),
  kind text NOT NULL CHECK (kind IN (
    'verified-outcome','decision','preference','lesson','summary'
  )),
  verified_outcome boolean NOT NULL,
  expires_at timestamptz,
  content_hash text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consultative_memory_scope_idx
  ON consultative_memory(organization_id, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS consultative_memory_expiry_idx
  ON consultative_memory(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_work_orders (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  agent_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'queued','processing','waiting-evidence','waiting-approval',
    'completed','failed','dead','skipped'
  )),
  expected_utility double precision NOT NULL,
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  maximum_attempts integer NOT NULL CHECK (maximum_attempts > 0),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_work_orders_claim_idx
  ON agent_work_orders(status, available_at, lease_until, expected_utility DESC);
CREATE INDEX IF NOT EXISTS agent_work_orders_account_idx
  ON agent_work_orders(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shadow_proposals (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  work_order_id text NOT NULL REFERENCES agent_work_orders(id),
  session_id text NOT NULL,
  llm_run_id text NOT NULL,
  agent_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending-approval','approved','rejected','superseded'
  )),
  risk text NOT NULL CHECK (risk IN ('low','medium','high','critical')),
  content_hash text NOT NULL,
  decided_at timestamptz,
  decided_by text,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shadow_proposals_inbox_idx
  ON shadow_proposals(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS shadow_proposals_work_order_idx
  ON shadow_proposals(work_order_id);

COMMIT;
