BEGIN;

DO $$
BEGIN
  ALTER TABLE source_image_uploads
    ADD CONSTRAINT source_image_uploads_scope_unique
    UNIQUE (organization_id, account_id, id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS catalog_acquisition_candidates (
  id text PRIMARY KEY,
  content_hash text NOT NULL UNIQUE CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  organization_id text NOT NULL,
  account_id text NOT NULL,
  source_image_upload_id text NOT NULL,
  visual_provider text NOT NULL,
  external_match_id text NOT NULL,
  similarity_bps integer NOT NULL CHECK (similarity_bps BETWEEN 0 AND 10000),
  supplier_source_id text NOT NULL,
  sku text NOT NULL,
  product_name text NOT NULL,
  product_url text NOT NULL,
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor > 0),
  stock_quantity bigint NOT NULL CHECK (stock_quantity >= 0),
  currency_id text NOT NULL CHECK (currency_id ~ '^[A-Z]{3}$'),
  evidence_refs jsonb NOT NULL CHECK (
    jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) = 2
  ),
  policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('needs-review', 'accepted', 'rejected')),
  requires_human_approval boolean NOT NULL DEFAULT true CHECK (requires_human_approval = true),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id, content_hash),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES commerce_accounts(organization_id, id),
  FOREIGN KEY (organization_id, account_id, source_image_upload_id)
    REFERENCES source_image_uploads(organization_id, account_id, id),
  FOREIGN KEY (organization_id, account_id, supplier_source_id)
    REFERENCES supplier_sources(organization_id, account_id, id)
);

CREATE INDEX IF NOT EXISTS catalog_acquisition_candidates_review_queue_idx
  ON catalog_acquisition_candidates(account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS catalog_acquisition_candidates_upload_idx
  ON catalog_acquisition_candidates(account_id, source_image_upload_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_catalog_acquisition_candidate_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payload_json->>'id' IS DISTINCT FROM NEW.id
    OR NEW.payload_json->>'contentHash' IS DISTINCT FROM NEW.content_hash
    OR NEW.payload_json->>'organizationId' IS DISTINCT FROM NEW.organization_id
    OR NEW.payload_json->>'accountId' IS DISTINCT FROM NEW.account_id
    OR NEW.payload_json->>'sourceImageUploadId' IS DISTINCT FROM NEW.source_image_upload_id
    OR NEW.payload_json->>'supplierSourceId' IS DISTINCT FROM NEW.supplier_source_id
    OR NEW.payload_json->>'status' IS DISTINCT FROM NEW.status
    OR NEW.payload_json->>'policyVersion' IS DISTINCT FROM NEW.policy_version
    OR NEW.payload_json->'evidenceRefs' IS DISTINCT FROM NEW.evidence_refs
    OR (NEW.payload_json->>'requiresHumanApproval')::boolean IS DISTINCT FROM NEW.requires_human_approval
  THEN
    RAISE EXCEPTION 'catalog acquisition payload does not match indexed columns';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'needs-review'
      OR NEW.reviewed_at IS NOT NULL
      OR NEW.reviewed_by IS NOT NULL
      OR NEW.review_note IS NOT NULL
      OR NEW.payload_json->'reviewedAt' <> 'null'::jsonb
      OR NEW.payload_json->'reviewedBy' <> 'null'::jsonb
      OR NEW.payload_json->'reviewNote' <> 'null'::jsonb
    THEN
      RAISE EXCEPTION 'new catalog acquisition candidate must start unreviewed';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'needs-review' OR NEW.status NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'catalog acquisition candidate review transition conflict';
  END IF;

  IF ROW(
    NEW.id,
    NEW.content_hash,
    NEW.organization_id,
    NEW.account_id,
    NEW.source_image_upload_id,
    NEW.visual_provider,
    NEW.external_match_id,
    NEW.similarity_bps,
    NEW.supplier_source_id,
    NEW.sku,
    NEW.product_name,
    NEW.product_url,
    NEW.unit_cost_minor,
    NEW.stock_quantity,
    NEW.currency_id,
    NEW.evidence_refs,
    NEW.policy_version,
    NEW.requires_human_approval,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.content_hash,
    OLD.organization_id,
    OLD.account_id,
    OLD.source_image_upload_id,
    OLD.visual_provider,
    OLD.external_match_id,
    OLD.similarity_bps,
    OLD.supplier_source_id,
    OLD.sku,
    OLD.product_name,
    OLD.product_url,
    OLD.unit_cost_minor,
    OLD.stock_quantity,
    OLD.currency_id,
    OLD.evidence_refs,
    OLD.policy_version,
    OLD.requires_human_approval,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'catalog acquisition candidate immutable fields cannot change';
  END IF;

  IF NEW.reviewed_at IS NULL OR NEW.reviewed_by IS NULL OR btrim(NEW.reviewed_by) = '' THEN
    RAISE EXCEPTION 'catalog acquisition review identity and time are required';
  END IF;
  IF NEW.reviewed_at < NEW.created_at THEN
    RAISE EXCEPTION 'catalog acquisition review cannot predate candidate creation';
  END IF;
  IF NEW.payload_json->>'reviewedAt' IS DISTINCT FROM to_char(
    NEW.reviewed_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) OR NEW.payload_json->>'reviewedBy' IS DISTINCT FROM NEW.reviewed_by
    OR NULLIF(NEW.payload_json->>'reviewNote', '') IS DISTINCT FROM NEW.review_note
  THEN
    RAISE EXCEPTION 'catalog acquisition review payload does not match indexed columns';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalog_acquisition_candidate_lifecycle_guard
  ON catalog_acquisition_candidates;
CREATE TRIGGER catalog_acquisition_candidate_lifecycle_guard
BEFORE INSERT OR UPDATE ON catalog_acquisition_candidates
FOR EACH ROW
EXECUTE FUNCTION enforce_catalog_acquisition_candidate_lifecycle();

COMMIT;
