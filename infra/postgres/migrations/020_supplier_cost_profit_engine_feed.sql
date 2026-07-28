BEGIN;

ALTER TABLE supplier_listing_links
  ADD COLUMN IF NOT EXISTS cost_authoritative boolean NOT NULL DEFAULT false;

WITH single_active_link AS (
  SELECT account_id, listing_id, MIN(supplier_source_id) AS supplier_source_id
  FROM supplier_listing_links
  WHERE active = true
  GROUP BY account_id, listing_id
  HAVING count(*) = 1
)
UPDATE supplier_listing_links link
SET cost_authoritative = true,
    updated_at = now()
FROM single_active_link single
WHERE link.account_id = single.account_id
  AND link.listing_id = single.listing_id
  AND link.supplier_source_id = single.supplier_source_id
  AND link.active = true;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_listing_authoritative_cost_idx
  ON supplier_listing_links(account_id, listing_id)
  WHERE active = true AND cost_authoritative = true;

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
BEGIN
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
  )
  SELECT
    link.organization_id,
    link.account_id,
    link.listing_id,
    'product-cost',
    product_unit_cost_minor,
    product_evidence_id,
    product_evidence_source,
    product_observed_at,
    product_content_hash,
    now()
  FROM supplier_listing_links link
  WHERE link.organization_id = product_organization_id
    AND link.account_id = product_account_id
    AND link.supplier_source_id = product_supplier_source_id
    AND link.sku = product_sku
    AND link.active = true
    AND link.cost_authoritative = true
  ON CONFLICT (account_id, listing_id, cost_kind) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    amount_minor = EXCLUDED.amount_minor,
    evidence_id = EXCLUDED.evidence_id,
    evidence_source = EXCLUDED.evidence_source,
    observed_at = EXCLUDED.observed_at,
    content_hash = EXCLUDED.content_hash,
    updated_at = now()
  WHERE economic_cost_observations.observed_at <= EXCLUDED.observed_at;

  UPDATE economic_listing_policies policy
  SET next_audit_at = LEAST(policy.next_audit_at, now()),
      last_error = NULL,
      updated_at = now()
  FROM supplier_listing_links link
  WHERE link.organization_id = product_organization_id
    AND link.account_id = product_account_id
    AND link.supplier_source_id = product_supplier_source_id
    AND link.sku = product_sku
    AND link.active = true
    AND link.cost_authoritative = true
    AND policy.organization_id = link.organization_id
    AND policy.account_id = link.account_id
    AND policy.listing_id = link.listing_id;
END;
$$;

CREATE OR REPLACE FUNCTION feed_supplier_product_cost_after_product_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sync_succeeded = true AND NEW.unit_cost_minor IS NOT NULL THEN
    PERFORM upsert_supplier_product_cost_for_links(
      NEW.organization_id,
      NEW.account_id,
      NEW.supplier_source_id,
      NEW.sku,
      NEW.unit_cost_minor,
      NEW.evidence_id,
      NEW.evidence_source,
      NEW.observed_at,
      NEW.evidence_content_hash
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_products_profit_engine_feed ON supplier_products;
CREATE TRIGGER supplier_products_profit_engine_feed
AFTER INSERT OR UPDATE ON supplier_products
FOR EACH ROW
EXECUTE FUNCTION feed_supplier_product_cost_after_product_change();

CREATE OR REPLACE FUNCTION feed_supplier_product_cost_after_link_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  product supplier_products%ROWTYPE;
BEGIN
  IF NEW.active = false OR NEW.cost_authoritative = false THEN
    RETURN NEW;
  END IF;

  SELECT * INTO product
  FROM supplier_products
  WHERE organization_id = NEW.organization_id
    AND account_id = NEW.account_id
    AND supplier_source_id = NEW.supplier_source_id
    AND sku = NEW.sku
    AND sync_succeeded = true
    AND unit_cost_minor IS NOT NULL;

  IF FOUND THEN
    PERFORM upsert_supplier_product_cost_for_links(
      product.organization_id,
      product.account_id,
      product.supplier_source_id,
      product.sku,
      product.unit_cost_minor,
      product.evidence_id,
      product.evidence_source,
      product.observed_at,
      product.evidence_content_hash
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_listing_links_profit_engine_feed ON supplier_listing_links;
CREATE TRIGGER supplier_listing_links_profit_engine_feed
AFTER INSERT OR UPDATE OF active, cost_authoritative, supplier_source_id, sku
ON supplier_listing_links
FOR EACH ROW
EXECUTE FUNCTION feed_supplier_product_cost_after_link_change();

COMMIT;
