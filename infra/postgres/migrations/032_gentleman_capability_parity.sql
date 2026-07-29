BEGIN;

CREATE TABLE agent_messages (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  conversation_id text NOT NULL,
  correlation_id text NOT NULL,
  recipient_agent_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','processing','completed','failed','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  maximum_attempts integer NOT NULL CHECK (maximum_attempts > 0),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_until timestamptz,
  completed_at timestamptz,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, account_id, idempotency_key),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX agent_messages_recipient_queue_idx
  ON agent_messages (recipient_agent_id, status, available_at, created_at);
CREATE INDEX agent_messages_conversation_idx
  ON agent_messages (organization_id, account_id, conversation_id, created_at DESC);

CREATE TABLE evidence_requests (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  conversation_id text NOT NULL,
  correlation_id text NOT NULL,
  responder_id text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','processing','fulfilled','incomplete','failed','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  maximum_attempts integer NOT NULL CHECK (maximum_attempts > 0),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_until timestamptz,
  completed_at timestamptz,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, account_id, idempotency_key),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX evidence_requests_queue_idx
  ON evidence_requests (status, available_at, created_at);

CREATE TABLE evidence_responses (
  id text PRIMARY KEY,
  request_id text NOT NULL UNIQUE REFERENCES evidence_requests(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  complete boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE semantic_memory_entries (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text,
  topic_key text NOT NULL,
  title text NOT NULL,
  observation text NOT NULL,
  rationale text NOT NULL,
  scope_description text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('active','needs-review','conflicted','superseded')),
  revision integer NOT NULL CHECK (revision > 0),
  verified_outcome boolean NOT NULL,
  expires_at timestamptz,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  search_document tsvector NOT NULL DEFAULT ''::tsvector,
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts (organization_id, id) ON DELETE CASCADE
);

CREATE FUNCTION semantic_memory_search_document_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_document := to_tsvector(
    'simple'::regconfig,
    concat_ws(
      ' ',
      NEW.topic_key,
      NEW.title,
      NEW.observation,
      NEW.rationale,
      NEW.scope_description,
      array_to_string(NEW.keywords, ' ')
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER semantic_memory_search_document_refresh_trigger
BEFORE INSERT OR UPDATE OF topic_key, title, observation, rationale, scope_description, keywords
ON semantic_memory_entries
FOR EACH ROW
EXECUTE FUNCTION semantic_memory_search_document_refresh();

CREATE INDEX semantic_memory_scope_topic_idx
  ON semantic_memory_entries (organization_id, account_id, topic_key, revision DESC);
CREATE INDEX semantic_memory_search_idx ON semantic_memory_entries USING gin (search_document);
CREATE UNIQUE INDEX semantic_memory_hash_scope_uq
  ON semantic_memory_entries (organization_id, coalesce(account_id, '*'), content_hash);

CREATE TABLE account_brain_snapshots (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  complete boolean NOT NULL,
  overall_score_bps integer CHECK (overall_score_bps BETWEEN 0 AND 10000),
  generated_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  UNIQUE (organization_id, account_id, content_hash),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX account_brain_latest_idx
  ON account_brain_snapshots (organization_id, account_id, generated_at DESC);

CREATE TABLE specialist_daemon_states (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  daemon_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  lease_owner text,
  lease_until timestamptz,
  previous_signals_hash text,
  payload_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, account_id, daemon_id),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX specialist_daemon_due_idx
  ON specialist_daemon_states (enabled, next_run_at, lease_until);

CREATE TABLE specialist_daemon_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  daemon_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','skipped','waiting-evidence','failed')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  UNIQUE (organization_id, account_id, daemon_id, content_hash),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX specialist_daemon_runs_latest_idx
  ON specialist_daemon_runs (organization_id, account_id, daemon_id, completed_at DESC);

CREATE TABLE supply_workflow_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  account_id text NOT NULL,
  kind text NOT NULL,
  supplier_id text NOT NULL,
  listing_id text,
  status text NOT NULL CHECK (status IN ('draft','ready','waiting-evidence','proposed','completed','failed')),
  dry_run boolean NOT NULL CHECK (dry_run = true),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, account_id, content_hash),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supply_workflow_latest_idx
  ON supply_workflow_runs (organization_id, account_id, created_at DESC);

CREATE TABLE product_lifecycle_assessments (
  organization_id text NOT NULL,
  account_id text NOT NULL,
  listing_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active','seasonal','off-season','obsolete-candidate','insufficient-data','uncertain')),
  confidence text NOT NULL CHECK (confidence IN ('low','medium','high')),
  assessed_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  PRIMARY KEY (organization_id, account_id, listing_id, content_hash),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX product_lifecycle_latest_idx
  ON product_lifecycle_assessments (organization_id, account_id, listing_id, assessed_at DESC);
CREATE INDEX product_lifecycle_state_idx
  ON product_lifecycle_assessments (organization_id, account_id, state, assessed_at DESC);

COMMIT;
