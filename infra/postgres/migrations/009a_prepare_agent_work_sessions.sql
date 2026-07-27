BEGIN;

-- Migration 001 created the legacy agent_work_sessions table. Prepare that table before
-- migration 010 creates indexes that depend on the Agent OS columns. This file sorts before
-- 010 and preserves the immutable hash of the already published migration 010.
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
FROM work_orders orders
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

COMMIT;
