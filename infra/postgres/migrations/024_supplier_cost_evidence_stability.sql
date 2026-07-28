BEGIN;

CREATE OR REPLACE FUNCTION upsert_supplier_product_cost_for_links(
  product_organization_id text,
  product_account_id text,
  product_supplier_source_id text,
  product_sku text,
  product_unit_cost_minor bigint,
  product_evidence_id text,
  product_evidence_source text,
  product_observed_at timestamptz,
  product_content_hash text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target_link supplier_listing_links%ROWTYPE;
  changed_rows integer;
BEGIN
  FOR target_link IN
    SELECT *
    FROM supplier_listing_links link
    WHERE link.organization_id = product_organization_id
      AND link.account_id = product_account_id
      AND link.supplier_source_id = product_supplier_source_id
      AND link.sku = product_sku
      AND link.active = true
      AND link.cost_authoritative = true
  LOOP
    IF product_unit_cost_minor IS NULL THEN
      PERFORM clear_supplier_product_cost_for_link(
        target_link.organization_id,
        target_link.account_id,
        target_link.listing_id,
        target_link.supplier_source_id,
        target_link.sku
      );
      CONTINUE;
    END IF;

    INSERT INTO economic_cost_observations (
      organization_id,
      account_id,
      listing_id,
      cost_kind,
      amount_minor,
      evidence_id,
      evidence_source,
      observed_at,
      content_hash,
      updated_at
    ) VALUES (
      target_link.organization_id,
      target_link.account_id,
      target_link.listing_id,
      'product-cost',
      product_unit_cost_minor,
      product_evidence_id,
      product_evidence_source,
      product_observed_at,
      product_content_hash,
      now()
    )
    ON CONFLICT (account_id, listing_id, cost_kind) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      amount_minor = EXCLUDED.amount_minor,
      evidence_id = EXCLUDED.evidence_id,
      evidence_source = EXCLUDED.evidence_source,
      observed_at = EXCLUDED.observed_at,
      content_hash = EXCLUDED.content_hash,
      updated_at = now()
    WHERE economic_cost_observations.observed_at <= EXCLUDED.observed_at
      AND (
        economic_cost_observations.amount_minor IS DISTINCT FROM EXCLUDED.amount_minor
        OR economic_cost_observations.observed_at
          + target_link.maximum_evidence_age_ms * interval '1 millisecond'
          < EXCLUDED.observed_at
      );

    GET DIAGNOSTICS changed_rows = ROW_COUNT;

    IF changed_rows > 0 THEN
      UPDATE economic_listing_policies
      SET next_audit_at = LEAST(next_audit_at, product_observed_at),
          last_error = NULL,
          updated_at = now()
      WHERE organization_id = target_link.organization_id
        AND account_id = target_link.account_id
        AND listing_id = target_link.listing_id;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
