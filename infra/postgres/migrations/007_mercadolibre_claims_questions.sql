BEGIN;

CREATE TABLE IF NOT EXISTS mercadolibre_claim_snapshots (
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  seller_id text NOT NULL,
  claim_id text NOT NULL,
  status text NOT NULL,
  last_updated timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  PRIMARY KEY (account_id, claim_id)
);

CREATE INDEX IF NOT EXISTS mercadolibre_claim_snapshots_attention_idx
  ON mercadolibre_claim_snapshots(account_id, status, last_updated DESC);

CREATE INDEX IF NOT EXISTS mercadolibre_claim_snapshots_freshness_idx
  ON mercadolibre_claim_snapshots(account_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS mercadolibre_question_snapshots (
  account_id text NOT NULL REFERENCES commerce_accounts(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  seller_id text NOT NULL,
  question_id text NOT NULL,
  item_id text NOT NULL,
  status text NOT NULL,
  date_created timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  PRIMARY KEY (account_id, question_id)
);

CREATE INDEX IF NOT EXISTS mercadolibre_question_snapshots_attention_idx
  ON mercadolibre_question_snapshots(account_id, status, date_created DESC);

CREATE INDEX IF NOT EXISTS mercadolibre_question_snapshots_item_idx
  ON mercadolibre_question_snapshots(account_id, item_id);

CREATE INDEX IF NOT EXISTS mercadolibre_question_snapshots_freshness_idx
  ON mercadolibre_question_snapshots(account_id, observed_at DESC);

COMMIT;
