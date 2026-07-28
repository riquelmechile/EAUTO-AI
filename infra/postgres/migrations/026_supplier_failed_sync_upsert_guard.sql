BEGIN;

CREATE OR REPLACE FUNCTION enforce_supplier_product_sync_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.observed_at <= OLD.observed_at THEN
    RAISE EXCEPTION 'supplier product observations must advance monotonically';
  END IF;

  IF NEW.sync_succeeded = false AND TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM supplier_products current_product
      WHERE current_product.supplier_source_id = NEW.supplier_source_id
        AND current_product.sku = NEW.sku
    ) THEN
      RAISE EXCEPTION 'first supplier product observation must be successful';
    END IF;

    RETURN NEW;
  END IF;

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

  IF TG_OP = 'INSERT' OR OLD.sync_succeeded = false THEN
    NEW.consecutive_successful_syncs := 1;
  ELSIF OLD.consecutive_successful_syncs < 2147483647 THEN
    NEW.consecutive_successful_syncs := OLD.consecutive_successful_syncs + 1;
  ELSE
    NEW.consecutive_successful_syncs := OLD.consecutive_successful_syncs;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
