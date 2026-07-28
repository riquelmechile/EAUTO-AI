BEGIN;

CREATE OR REPLACE FUNCTION assign_supplier_listing_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_other_active_link boolean;
  latest_product_observation_at timestamptz;
BEGIN
  IF NEW.active = false THEN
    NEW.cost_authoritative := false;
    NEW.availability_authoritative := false;
    NEW.lease_owner := NULL;
    NEW.lease_until := NULL;
    NEW.next_audit_at := 'infinity'::timestamptz;
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
    has_other_active_link := true;
  END IF;

  IF has_other_active_link = false THEN
    NEW.cost_authoritative := true;
    NEW.availability_authoritative := true;
  END IF;

  IF NEW.availability_authoritative = false THEN
    NEW.lease_owner := NULL;
    NEW.lease_until := NULL;
    NEW.next_audit_at := 'infinity'::timestamptz;
  ELSIF TG_OP = 'INSERT' OR OLD.availability_authoritative = false THEN
    SELECT product.last_observation_at
    INTO latest_product_observation_at
    FROM supplier_products product
    WHERE product.organization_id = NEW.organization_id
      AND product.account_id = NEW.account_id
      AND product.supplier_source_id = NEW.supplier_source_id
      AND product.sku = NEW.sku;

    NEW.next_audit_at := LEAST(
      NEW.next_audit_at,
      COALESCE(latest_product_observation_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
