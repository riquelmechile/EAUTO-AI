BEGIN;

-- Preserve the full organization/account boundary in every evidence and
-- fingerprint key used by Product Identification.
CREATE UNIQUE INDEX IF NOT EXISTS source_image_uploads_scope_id_idx
  ON source_image_uploads(organization_id, account_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS product_identification_results_scope_source_idx
  ON product_identification_results(
    organization_id,
    account_id,
    id,
    source_image_upload_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS product_visual_fingerprints_scope_product_idx
  ON product_visual_fingerprints(
    organization_id,
    account_id,
    product_id,
    algorithm,
    version
  );

CREATE INDEX IF NOT EXISTS product_identification_results_scoped_status_idx
  ON product_identification_results(
    organization_id,
    account_id,
    status,
    evaluated_at DESC
  );

CREATE INDEX IF NOT EXISTS product_identification_reviews_scoped_decision_idx
  ON product_identification_reviews(
    organization_id,
    account_id,
    decision,
    decided_at DESC
  );

CREATE INDEX IF NOT EXISTS product_visual_fingerprints_scoped_search_idx
  ON product_visual_fingerprints(
    organization_id,
    account_id,
    algorithm,
    version
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_identification_results_scoped_source_fkey'
  ) THEN
    ALTER TABLE product_identification_results
      ADD CONSTRAINT product_identification_results_scoped_source_fkey
      FOREIGN KEY (organization_id, account_id, source_image_upload_id)
      REFERENCES source_image_uploads(organization_id, account_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_identification_reviews_scoped_source_fkey'
  ) THEN
    ALTER TABLE product_identification_reviews
      ADD CONSTRAINT product_identification_reviews_scoped_source_fkey
      FOREIGN KEY (
        organization_id,
        account_id,
        identification_id,
        source_image_upload_id
      )
      REFERENCES product_identification_results(
        organization_id,
        account_id,
        id,
        source_image_upload_id
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_visual_fingerprints_scoped_source_fkey'
  ) THEN
    ALTER TABLE product_visual_fingerprints
      ADD CONSTRAINT product_visual_fingerprints_scoped_source_fkey
      FOREIGN KEY (
        organization_id,
        account_id,
        identification_id,
        source_image_upload_id
      )
      REFERENCES product_identification_results(
        organization_id,
        account_id,
        id,
        source_image_upload_id
      );
  END IF;
END
$$;

COMMIT;
