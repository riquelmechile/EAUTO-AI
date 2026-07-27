BEGIN;

CREATE TABLE IF NOT EXISTS action_lifecycle_delivery_log (
  outbox_event_id text PRIMARY KEY REFERENCES transactional_outbox(id),
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  action_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'action.proposed','action.reviewed','action.approved','action.execution.started',
    'action.executed','action.verified','action.failed','action.uncertain'
  )),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  delivered_at timestamptz NOT NULL
);

ALTER TABLE action_lifecycle_delivery_log
  ADD CONSTRAINT action_lifecycle_delivery_action_fk
  FOREIGN KEY (account_id, action_id) REFERENCES business_actions(account_id, id);

CREATE INDEX IF NOT EXISTS action_lifecycle_delivery_action_idx
  ON action_lifecycle_delivery_log(account_id, action_id, delivered_at ASC);

COMMIT;
