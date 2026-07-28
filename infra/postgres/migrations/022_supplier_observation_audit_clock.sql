BEGIN;

CREATE OR REPLACE FUNCTION schedule_supplier_link_audits_from_observation()
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
    AND link.active = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_products_schedule_link_audits ON supplier_products;
CREATE TRIGGER supplier_products_schedule_link_audits
AFTER INSERT OR UPDATE OF last_observation_at ON supplier_products
FOR EACH ROW
EXECUTE FUNCTION schedule_supplier_link_audits_from_observation();

UPDATE supplier_listing_links link
SET next_audit_at = LEAST(link.next_audit_at, product.last_observation_at),
    updated_at = now()
FROM supplier_products product
WHERE link.organization_id = product.organization_id
  AND link.account_id = product.account_id
  AND link.supplier_source_id = product.supplier_source_id
  AND link.sku = product.sku
  AND link.active = true;

COMMIT;
