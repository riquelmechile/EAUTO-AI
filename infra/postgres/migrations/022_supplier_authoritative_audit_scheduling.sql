BEGIN;

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
    NEW.next_audit_at := LEAST(NEW.next_audit_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_listing_links_assign_authority ON supplier_listing_links;
CREATE TRIGGER supplier_listing_links_assign_authority
BEFORE INSERT OR UPDATE ON supplier_listing_links
FOR EACH ROW
EXECUTE FUNCTION assign_supplier_listing_authority();

CREATE OR REPLACE FUNCTION schedule_authoritative_supplier_stock_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE supplier_listing_links link
  SET next_audit_at = LEAST(link.next_audit_at, NEW.last_observation_at),
      updated_at = now()
  WHERE link.organization_id = NEW.organization_id
    AND link.account_id = NEW.account_id
    AND link.supplier_source_id = NEW.supplier_source_id
    AND link.sku = NEW.sku
    AND link.active = true
    AND link.availability_authoritative = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_products_schedule_authoritative_audit ON supplier_products;
CREATE TRIGGER supplier_products_schedule_authoritative_audit
AFTER INSERT OR UPDATE ON supplier_products
FOR EACH ROW
EXECUTE FUNCTION schedule_authoritative_supplier_stock_audit();

UPDATE supplier_listing_links
SET lease_owner = NULL,
    lease_until = NULL,
    next_audit_at = 'infinity'::timestamptz,
    updated_at = now()
WHERE active = false OR availability_authoritative = false;

UPDATE supplier_listing_links link
SET next_audit_at = LEAST(link.next_audit_at, product.last_observation_at),
    updated_at = now()
FROM supplier_products product
WHERE link.organization_id = product.organization_id
  AND link.account_id = product.account_id
  AND link.supplier_source_id = product.supplier_source_id
  AND link.sku = product.sku
  AND link.active = true
  AND link.availability_authoritative = true;

COMMIT;
