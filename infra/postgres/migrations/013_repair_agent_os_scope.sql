BEGIN;

-- Migration 001 introduced an early agent_work_sessions shape. Migration 010 used
-- CREATE TABLE IF NOT EXISTS, so an upgraded database retained the legacy table.
-- Repair it in place to preserve llm_runs/session foreign keys and any historical rows.
ALTER TABLE agent_work_sessions
  ADD COLUMN IF NOT EXISTS organization_id text,
  ADD COLUMN IF NOT EXISTS objective_id text,
  ADD COLUMN IF NOT EXISTS parent_session_id text,
  ADD COLUMN IF NOT EXISTS delegation_depth integer,
  ADD COLUMN IF NOT EXISTS requested_action text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS budget_minor_clp bigint,
  ADD COLUMN IF NOT EXISTS spent_minor_clp bigint,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS payload_json jsonb;

UPDATE agent_work_sessions session
SET organization_id = account.organization_id
FROM commerce_accounts account
WHERE account.id = session.account_id
  AND session.organization_id IS NULL;

UPDATE agent_work_sessions session
SET objective_id = COALESCE(orders.objective_id, 'legacy:' || session.id)
FROM (SELECT id, objective_id FROM work_orders) orders
WHERE session.work_order_id = orders.id
  AND session.objective_id IS NULL;

UPDATE agent_work_sessions
SET objective_id = COALESCE(objective_id, 'legacy:' || id),
    delegation_depth = COALESCE(delegation_depth, 0),
    requested_action = COALESCE(requested_action, 'Legacy session ' || id),
    idempotency_key = COALESCE(idempotency_key, 'legacy:' || id),
    budget_minor_clp = COALESCE(budget_minor_clp, 0),
    spent_minor_clp = COALESCE(spent_minor_clp, 0),
    deadline_at = COALESCE(deadline_at, COALESCE(ended_at, started_at, now()) + interval '1 day'),
    created_at = COALESCE(created_at, started_at, now()),
    updated_at = COALESCE(updated_at, ended_at, started_at, now()),
    status = CASE
      WHEN status IN (
        'queued','running','waiting-evidence','waiting-approval',
        'completed','failed','cancelled'
      ) THEN status
      ELSE 'failed'
    END;

UPDATE agent_work_sessions
SET payload_json = jsonb_build_object(
  'id', id,
  'organizationId', organization_id,
  'accountId', account_id,
  'objectiveId', objective_id,
  'agentId', agent_id,
  'parentSessionId', parent_session_id,
  'delegationDepth', delegation_depth,
  'status', status,
  'requestedAction', requested_action,
  'expectedEvidenceKinds', '[]'::jsonb,
  'evidenceRefs', '[]'::jsonb,
  'outputRefs', '[]'::jsonb,
  'policyVersion', 'legacy-v1',
  'skillVersions', '[]'::jsonb,
  'promptPrefixHash', COALESCE(stable_prompt_hash, repeat('0', 64)),
  'idempotencyKey', idempotency_key,
  'budgetMinorClp', budget_minor_clp,
  'spentMinorClp', spent_minor_clp,
  'maximumIterations', 1,
  'iterationCount', 0,
  'startedAt', CASE WHEN started_at IS NULL THEN NULL ELSE to_jsonb(started_at::text) END,
  'heartbeatAt', CASE WHEN started_at IS NULL THEN NULL ELSE to_jsonb(started_at::text) END,
  'deadlineAt', deadline_at::text,
  'completedAt', CASE WHEN ended_at IS NULL THEN NULL ELSE to_jsonb(ended_at::text) END,
  'failureReason', CASE WHEN status = 'failed' THEN 'Migrated legacy session' ELSE NULL END,
  'createdAt', created_at::text,
  'updatedAt', updated_at::text
)
WHERE payload_json IS NULL;

ALTER TABLE agent_work_sessions
  ALTER COLUMN signals_hash DROP NOT NULL,
  ALTER COLUMN stable_prompt_hash DROP NOT NULL,
  ALTER COLUMN started_at DROP NOT NULL,
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN objective_id SET NOT NULL,
  ALTER COLUMN delegation_depth SET NOT NULL,
  ALTER COLUMN requested_action SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN budget_minor_clp SET NOT NULL,
  ALTER COLUMN spent_minor_clp SET NOT NULL,
  ALTER COLUMN deadline_at SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN payload_json SET NOT NULL;

ALTER TABLE agent_work_sessions
  DROP CONSTRAINT IF EXISTS agent_work_sessions_idempotency_key_key,
  DROP CONSTRAINT IF EXISTS agent_work_sessions_delegation_depth_check,
  DROP CONSTRAINT IF EXISTS agent_work_sessions_status_check,
  DROP CONSTRAINT IF EXISTS agent_work_sessions_budget_minor_clp_check,
  DROP CONSTRAINT IF EXISTS agent_work_sessions_spent_minor_clp_check;

ALTER TABLE agent_work_sessions
  ADD CONSTRAINT agent_work_sessions_delegation_depth_check
    CHECK (delegation_depth BETWEEN 0 AND 2),
  ADD CONSTRAINT agent_work_sessions_status_check
    CHECK (status IN (
      'queued','running','waiting-evidence','waiting-approval','completed','failed','cancelled'
    )),
  ADD CONSTRAINT agent_work_sessions_budget_minor_clp_check CHECK (budget_minor_clp >= 0),
  ADD CONSTRAINT agent_work_sessions_spent_minor_clp_check CHECK (spent_minor_clp >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_work_sessions_organization_id_fkey'
  ) THEN
    ALTER TABLE agent_work_sessions
      ADD CONSTRAINT agent_work_sessions_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_work_sessions_parent_session_id_fkey'
  ) THEN
    ALTER TABLE agent_work_sessions
      ADD CONSTRAINT agent_work_sessions_parent_session_id_fkey
      FOREIGN KEY (parent_session_id) REFERENCES agent_work_sessions(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS agent_work_sessions_scope_idempotency_idx
  ON agent_work_sessions(organization_id, account_id, idempotency_key);
CREATE INDEX IF NOT EXISTS agent_work_sessions_scope_created_idx
  ON agent_work_sessions(organization_id, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_work_sessions_agent_status_idx
  ON agent_work_sessions(agent_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_work_sessions_parent_idx
  ON agent_work_sessions(parent_session_id)
  WHERE parent_session_id IS NOT NULL;

ALTER TABLE agent_work_orders
  DROP CONSTRAINT IF EXISTS agent_work_orders_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS agent_work_orders_scope_idempotency_idx
  ON agent_work_orders(organization_id, account_id, idempotency_key);
CREATE INDEX IF NOT EXISTS agent_work_orders_scope_created_idx
  ON agent_work_orders(organization_id, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operational_evidence_packs_scope_created_idx
  ON operational_evidence_packs(organization_id, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shadow_proposals_scope_inbox_idx
  ON shadow_proposals(organization_id, account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_preflight_scope_created_idx
  ON agent_preflight_reports(organization_id, account_id, generated_at DESC);

COMMIT;
