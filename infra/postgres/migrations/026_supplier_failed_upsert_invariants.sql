BEGIN;

CREATE OR REPLACE FUNCTION enforce_supplier_product_sync_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  incoming_observed_at timestamptz;
  current_product_exists boolean;
BEGIN
  incoming_observed_at := NEW.observed_at;

  IF TG_OP = 'INSERT' THEN
    IF NEW.sync_succeeded = false THEN
      SELECT EXISTS (
        SELECT 1
        FROM supplier_products product
        WHERE product.supplier_source_id = NEW.supplier_source_id
          AND product.sku = NEW.sku
      ) INTO current_product_exists;

      IF current_product_exists = false THEN
        RAISE EXCEPTION 'first supplier product observation must be successful';
      END IF;
    END IF;

    NEW.last_observation_at := incoming_observed_at;
    NEW.consecutive_successful_syncs := CASE WHEN NEW.sync_succeeded THEN 1 ELSE 0 END;
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

COMMIT;
