BEGIN;

ALTER TABLE transactional_outbox
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS account_id text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

UPDATE transactional_outbox
SET idempotency_key = COALESCE(idempotency_key, id)
WHERE idempotency_key IS NULL;

ALTER TABLE transactional_outbox
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_idempotency_key_idx
  ON transactional_outbox(idempotency_key);

CREATE INDEX IF NOT EXISTS outbox_claim_idx
  ON transactional_outbox(status, available_at, locked_until, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactional_outbox_status_check'
  ) THEN
    ALTER TABLE transactional_outbox
      ADD CONSTRAINT transactional_outbox_status_check
      CHECK (status IN ('pending', 'processing', 'processed', 'dead'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactional_outbox_account_fk'
  ) THEN
    ALTER TABLE transactional_outbox
      ADD CONSTRAINT transactional_outbox_account_fk
      FOREIGN KEY (account_id) REFERENCES commerce_accounts(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS operator_audit_log (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  organization_id text NOT NULL REFERENCES organizations(id),
  account_id text REFERENCES commerce_accounts(id),
  permission text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_audit_actor_recorded_idx
  ON operator_audit_log(actor_id, recorded_at DESC);

COMMIT;
