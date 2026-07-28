BEGIN;

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS last_observation_at timestamptz;

UPDATE supplier_products
SET last_observation_at = observed_at
WHERE last_observation_at IS NULL;

ALTER TABLE supplier_products
  ALTER COLUMN last_observation_at SET NOT NULL;

ALTER TABLE supplier_listing_links
  ADD COLUMN IF NOT EXISTS availability_authoritative boolean NOT NULL DEFAULT false;

UPDATE supplier_listing_links
SET cost_authoritative = false,
    availability_authoritative = false,
    updated_at = now()
WHERE active = false
  AND (cost_authoritative = true OR availability_authoritative = true);

WITH single_active_link AS (
  SELECT account_id, listing_id, MIN(supplier_source_id) AS supplier_source_id
  FROM supplier_listing_links
  WHERE active = true
  GROUP BY account_id, listing_id
  HAVING count(*) = 1
)
UPDATE supplier_listing_links link
SET cost_authoritative = true,
    availability_authoritative = true,
    updated_at = now()
FROM single_active_link single
WHERE link.account_id = single.account_id
  AND link.listing_id = single.listing_id
  AND link.supplier_source_id = single.supplier_source_id
  AND link.active = true;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_listing_authoritative_availability_idx
  ON supplier_listing_links(account_id, listing_id)
  WHERE active = true AND availability_authoritative = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'supplier_inactive_links_not_authoritative'
  ) THEN
    ALTER TABLE supplier_listing_links
      ADD CONSTRAINT supplier_inactive_links_not_authoritative
      CHECK (active OR (cost_authoritative = false AND availability_authoritative = false));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_supplier_product_sync_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  incoming_observed_at timestamptz;
BEGIN
  incoming_observed_at := NEW.observed_at;

  IF TG_OP = 'INSERT' THEN
    IF NEW.sync_succeeded = false THEN
      RAISE EXCEPTION 'first supplier product observation must be successful';
    END IF;
    NEW.last_observation_at := incoming_observed_at;
    NEW.consecutive_successful_syncs := 1;
    RETURN NEW;
  END IF;

  IF incoming_observed_at <= OLD.last_observation_at THEN
    RAISE EXCEPTION 'supplier product observations must advance monotonically';
  END IF;

  NEW.last_observation_at := incoming_observed_at;

  IF NEW.sync_succeeded = false THEN
    NEW.name := OLD.name;
    NEW.previous_stock_qty := OLD.previous_stock_qty;
    NEW.stock_qty := OLD.stock_qty;
    NEW.previous_unit_cost_minor := OLD.previous_unit_cost_minor;
    NEW.unit_cost_minor := OLD.unit_cost_minor;
    NEW.consecutive_successful_syncs := 0;
    NEW.observed_at := OLD.observed_at;
    NEW.evidence_id := OLD.evidence_id;
    NEW.evidence_source := OLD.evidence_source;
    NEW.evidence_content_hash := OLD.evidence_content_hash;
    NEW.current_content_hash := OLD.current_content_hash;
    RETURN NEW;
  END IF;

  IF OLD.sync_succeeded = false THEN
    NEW.consecutive_successful_syncs := 1;
  ELSIF OLD.consecutive_successful_syncs < 2147483647 THEN
    NEW.consecutive_successful_syncs := OLD.consecutive_successful_syncs + 1;
  ELSE
    NEW.consecutive_successful_syncs := OLD.consecutive_successful_syncs;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assign_supplier_listing_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_other_active_link boolean;
BEGIN
  IF NEW.active = false THEN
    NEW.cost_authoritative := false;
    NEW.availability_authoritative := false;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1
      FROM supplier_listing_links link
      WHERE link.account_id = NEW.account_id
        AND link.listing_id = NEW.listing_id
        AND link.active = true
    ) INTO has_other_active_link;
  ELSIF OLD.active = false
     OR OLD.account_id IS DISTINCT FROM NEW.account_id
     OR OLD.listing_id IS DISTINCT FROM NEW.listing_id THEN
    SELECT EXISTS (
      SELECT 1
      FROM supplier_listing_links link
      WHERE link.account_id = NEW.account_id
        AND link.listing_id = NEW.listing_id
        AND link.active = true
        AND NOT (
          link.account_id = OLD.account_id
          AND link.listing_id = OLD.listing_id
          AND link.supplier_source_id = OLD.supplier_source_id
          AND link.sku = OLD.sku
        )
    ) INTO has_other_active_link;
  ELSE
    RETURN NEW;
  END IF;

  IF has_other_active_link = false THEN
    NEW.cost_authoritative := true;
    NEW.availability_authoritative := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_listing_links_assign_authority ON supplier_listing_links;
CREATE TRIGGER supplier_listing_links_assign_authority
BEFORE INSERT OR UPDATE OF active, account_id, listing_id
ON supplier_listing_links
FOR EACH ROW
EXECUTE FUNCTION assign_supplier_listing_authority();

CREATE OR REPLACE FUNCTION clear_supplier_product_cost_for_link(
  link_organization_id text,
  link_account_id text,
  link_listing_id text,
  link_supplier_source_id text,
  link_sku text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM economic_cost_observations cost
  WHERE cost.organization_id = link_organization_id
    AND cost.account_id = link_account_id
    AND cost.listing_id = link_listing_id
    AND cost.cost_kind = 'product-cost'
    AND EXISTS (
      SELECT 1
      FROM supplier_product_observations observation
      WHERE observation.organization_id = link_organization_id
        AND observation.account_id = link_account_id
        AND observation.supplier_source_id = link_supplier_source_id
        AND observation.sku = link_sku
        AND COALESCE((observation.payload_json ->> 'syncSucceeded')::boolean, false) = true
        AND observation.payload_json -> 'evidence' ->> 'id' = cost.evidence_id
        AND observation.payload_json -> 'evidence' ->> 'contentHash' = cost.content_hash
    );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count > 0 THEN
    UPDATE economic_listing_policies
    SET next_audit_at = LEAST(next_audit_at, now()),
        last_error = NULL,
        updated_at = now()
    WHERE organization_id = link_organization_id
      AND account_id = link_account_id
      AND listing_id = link_listing_id;
  END IF;

  RETURN deleted_count > 0;
END;
$$;

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
    ELSE
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
      WHERE economic_cost_observations.observed_at <= EXCLUDED.observed_at;

      UPDATE economic_listing_policies
      SET next_audit_at = LEAST(next_audit_at, now()),
          last_error = NULL,
          updated_at = now()
      WHERE organization_id = target_link.organization_id
        AND account_id = target_link.account_id
        AND listing_id = target_link.listing_id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION feed_supplier_product_cost_after_product_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sync_succeeded = true THEN
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

CREATE OR REPLACE FUNCTION feed_supplier_product_cost_after_link_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  product supplier_products%ROWTYPE;
  old_authority_removed boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_authority_removed := OLD.active = true
      AND OLD.cost_authoritative = true
      AND (
        NEW.active = false
        OR NEW.cost_authoritative = false
        OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
        OR OLD.account_id IS DISTINCT FROM NEW.account_id
        OR OLD.listing_id IS DISTINCT FROM NEW.listing_id
        OR OLD.supplier_source_id IS DISTINCT FROM NEW.supplier_source_id
        OR OLD.sku IS DISTINCT FROM NEW.sku
      );

    IF old_authority_removed THEN
      PERFORM clear_supplier_product_cost_for_link(
        OLD.organization_id,
        OLD.account_id,
        OLD.listing_id,
        OLD.supplier_source_id,
        OLD.sku
      );
    END IF;
  END IF;

  IF NEW.active = false OR NEW.cost_authoritative = false THEN
    RETURN NEW;
  END IF;

  SELECT * INTO product
  FROM supplier_products
  WHERE organization_id = NEW.organization_id
    AND account_id = NEW.account_id
    AND supplier_source_id = NEW.supplier_source_id
    AND sku = NEW.sku
    AND sync_succeeded = true;

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
AFTER INSERT OR UPDATE OF active, cost_authoritative, organization_id,
  account_id, listing_id, supplier_source_id, sku
ON supplier_listing_links
FOR EACH ROW
EXECUTE FUNCTION feed_supplier_product_cost_after_link_change();

DELETE FROM economic_cost_observations cost
WHERE cost.cost_kind = 'product-cost'
  AND EXISTS (
    SELECT 1
    FROM supplier_product_observations observation
    WHERE observation.organization_id = cost.organization_id
      AND observation.account_id = cost.account_id
      AND COALESCE((observation.payload_json ->> 'syncSucceeded')::boolean, false) = true
      AND observation.payload_json -> 'evidence' ->> 'id' = cost.evidence_id
      AND observation.payload_json -> 'evidence' ->> 'contentHash' = cost.content_hash
  )
  AND NOT EXISTS (
    SELECT 1
    FROM supplier_listing_links link
    JOIN supplier_product_observations observation
      ON observation.organization_id = link.organization_id
     AND observation.account_id = link.account_id
     AND observation.supplier_source_id = link.supplier_source_id
     AND observation.sku = link.sku
     AND COALESCE((observation.payload_json ->> 'syncSucceeded')::boolean, false) = true
     AND observation.payload_json -> 'evidence' ->> 'id' = cost.evidence_id
     AND observation.payload_json -> 'evidence' ->> 'contentHash' = cost.content_hash
    WHERE link.organization_id = cost.organization_id
      AND link.account_id = cost.account_id
      AND link.listing_id = cost.listing_id
      AND link.active = true
      AND link.cost_authoritative = true
  );

DO $$
DECLARE
  product supplier_products%ROWTYPE;
BEGIN
  FOR product IN
    SELECT DISTINCT supplier_product.*
    FROM supplier_products supplier_product
    JOIN supplier_listing_links link
      ON link.organization_id = supplier_product.organization_id
     AND link.account_id = supplier_product.account_id
     AND link.supplier_source_id = supplier_product.supplier_source_id
     AND link.sku = supplier_product.sku
     AND link.active = true
     AND link.cost_authoritative = true
    WHERE supplier_product.sync_succeeded = true
  LOOP
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
  END LOOP;
END;
$$;

COMMIT;
