BEGIN;

-- Composite keys allow the database to enforce the same organization/account boundary as the API.
ALTER TABLE commerce_accounts
  ADD CONSTRAINT commerce_accounts_organization_id_id_key UNIQUE (organization_id, id);

ALTER TABLE agent_work_sessions
  ADD CONSTRAINT agent_work_sessions_scope_id_key UNIQUE (organization_id, account_id, id);
ALTER TABLE agent_work_sessions
  DROP CONSTRAINT IF EXISTS agent_work_sessions_parent_session_id_fkey;
ALTER TABLE agent_work_sessions
  ADD CONSTRAINT agent_work_sessions_scoped_parent_fkey
  FOREIGN KEY (organization_id, account_id, parent_session_id)
  REFERENCES agent_work_sessions(organization_id, account_id, id);

ALTER TABLE agent_work_orders
  ADD CONSTRAINT agent_work_orders_scope_id_key UNIQUE (organization_id, account_id, id);
ALTER TABLE llm_runs
  ADD CONSTRAINT llm_runs_scope_id_key UNIQUE (organization_id, account_id, id);
ALTER TABLE llm_runs
  DROP CONSTRAINT IF EXISTS llm_runs_session_id_fkey;
ALTER TABLE llm_runs
  ADD CONSTRAINT llm_runs_scoped_session_fkey
  FOREIGN KEY (organization_id, account_id, session_id)
  REFERENCES agent_work_sessions(organization_id, account_id, id);

ALTER TABLE shadow_proposals
  DROP CONSTRAINT IF EXISTS shadow_proposals_work_order_id_fkey;
ALTER TABLE shadow_proposals
  ADD CONSTRAINT shadow_proposals_scoped_work_order_fkey
  FOREIGN KEY (organization_id, account_id, work_order_id)
  REFERENCES agent_work_orders(organization_id, account_id, id);
ALTER TABLE shadow_proposals
  ADD CONSTRAINT shadow_proposals_scoped_session_fkey
  FOREIGN KEY (organization_id, account_id, session_id)
  REFERENCES agent_work_sessions(organization_id, account_id, id);
ALTER TABLE shadow_proposals
  ADD CONSTRAINT shadow_proposals_scoped_llm_run_fkey
  FOREIGN KEY (organization_id, account_id, llm_run_id)
  REFERENCES llm_runs(organization_id, account_id, id);

ALTER TABLE business_actions
  ADD CONSTRAINT business_actions_account_id_id_key UNIQUE (account_id, id);
ALTER TABLE verifiable_receipts
  ADD CONSTRAINT receipts_scoped_action_fkey
  FOREIGN KEY (account_id, action_id)
  REFERENCES business_actions(account_id, id);

-- A receipt chain must be linear. These constraints prevent two roots or two successors.
CREATE UNIQUE INDEX IF NOT EXISTS receipts_single_root_per_action_idx
  ON verifiable_receipts(action_id)
  WHERE previous_receipt_hash IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS receipts_single_successor_idx
  ON verifiable_receipts(action_id, previous_receipt_hash)
  WHERE previous_receipt_hash IS NOT NULL;

-- One unexpired approval record per exact action. Historical duplicates are reduced deterministically.
DELETE FROM approvals older
USING approvals newer
WHERE older.action_id = newer.action_id
  AND (older.approved_at, older.id) < (newer.approved_at, newer.id);
CREATE UNIQUE INDEX IF NOT EXISTS approvals_single_action_idx ON approvals(action_id);

-- All tables that store both organization and account must agree with commerce_accounts.
ALTER TABLE source_image_uploads
  ADD CONSTRAINT source_image_uploads_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE operator_audit_log
  ADD CONSTRAINT operator_audit_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE mercadolibre_oauth_states
  ADD CONSTRAINT meli_oauth_states_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE mercadolibre_connections
  ADD CONSTRAINT meli_connections_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE mercadolibre_listing_snapshots
  ADD CONSTRAINT meli_listings_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE mercadolibre_claim_snapshots
  ADD CONSTRAINT meli_claims_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE mercadolibre_question_snapshots
  ADD CONSTRAINT meli_questions_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE mercadolibre_order_snapshots
  ADD CONSTRAINT meli_orders_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE mercadolibre_reputation_snapshots
  ADD CONSTRAINT meli_reputation_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE mercadolibre_notifications
  ADD CONSTRAINT meli_notifications_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE consultative_memory
  ADD CONSTRAINT consultative_memory_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);

ALTER TABLE agent_preflight_reports
  ADD CONSTRAINT agent_preflight_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE operational_evidence_packs
  ADD CONSTRAINT evidence_packs_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE agent_work_orders
  ADD CONSTRAINT work_orders_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE shadow_proposals
  ADD CONSTRAINT proposals_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);
ALTER TABLE llm_runs
  ADD CONSTRAINT llm_runs_scoped_account_fkey
  FOREIGN KEY (organization_id, account_id)
  REFERENCES commerce_accounts(organization_id, id);

COMMIT;
