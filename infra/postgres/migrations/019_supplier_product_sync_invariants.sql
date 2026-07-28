BEGIN;

CREATE OR REPLACE FUNCTION enforce_supplier_product_sync_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  recovery_threshold bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.observed_at <= OLD.observed_at THEN
    RETURN OLD;
  END IF;

  IF NEW.sync_succeeded = false THEN
    NEW.consecutive_successful_syncs := 0;
    IF TG_OP = 'UPDATE' THEN
      NEW.previous_stock_qty := OLD.previous_stock_qty;
      NEW.stock_qty := OLD.stock_qty;
      NEW.previous_unit_cost_minor := OLD.previous_unit_cost_minor;
      NEW.unit_cost_minor := OLD.unit_cost_minor;
      NEW.observed_at := OLD.observed_at;
      NEW.evidence_id := OLD.evidence_id;
      NEW.evidence_source := OLD.evidence_source;
      NEW.evidence_content_hash := OLD.evidence_content_hash;
      NEW.current_content_hash := OLD.current_content_hash;
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(link.recovery_stock_threshold), 0)
  INTO recovery_threshold
  FROM supplier_listing_links link
  WHERE link.organization_id = NEW.organization_id
    AND link.account_id = NEW.account_id
    AND link.supplier_source_id = NEW.supplier_source_id
    AND link.sku = NEW.sku
    AND link.active = true;

  IF NEW.stock_qty > recovery_threshold THEN
    IF TG_OP = 'INSERT'
      OR OLD.sync_succeeded = false
      OR OLD.stock_qty <= recovery_threshold THEN
      NEW.consecutive_successful_syncs := 1;
    ELSE
      NEW.consecutive_successful_syncs := OLD.consecutive_successful_syncs + 1;
    END IF;
  ELSE
    NEW.consecutive_successful_syncs := 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_products_sync_invariants ON supplier_products;
CREATE TRIGGER supplier_products_sync_invariants
BEFORE INSERT OR UPDATE ON supplier_products
FOR EACH ROW
EXECUTE FUNCTION enforce_supplier_product_sync_invariants();

COMMIT;
