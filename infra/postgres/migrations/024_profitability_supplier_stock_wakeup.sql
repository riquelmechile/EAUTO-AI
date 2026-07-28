BEGIN;

CREATE OR REPLACE FUNCTION wake_supplier_stock_after_profitability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE supplier_listing_links link
  SET next_audit_at = LEAST(link.next_audit_at, NEW.calculated_at),
      updated_at = now()
  WHERE link.organization_id = NEW.organization_id
    AND link.account_id = NEW.account_id
    AND link.listing_id = NEW.listing_id
    AND link.active = true
    AND link.availability_authoritative = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profitability_snapshots_wake_supplier_stock
  ON profitability_snapshots;
CREATE TRIGGER profitability_snapshots_wake_supplier_stock
AFTER INSERT ON profitability_snapshots
FOR EACH ROW
EXECUTE FUNCTION wake_supplier_stock_after_profitability();

UPDATE supplier_listing_links link
SET next_audit_at = LEAST(link.next_audit_at, profitability.calculated_at),
    updated_at = now()
FROM LATERAL (
  SELECT snapshot.calculated_at
  FROM profitability_snapshots snapshot
  WHERE snapshot.organization_id = link.organization_id
    AND snapshot.account_id = link.account_id
    AND snapshot.listing_id = link.listing_id
  ORDER BY snapshot.calculated_at DESC, snapshot.created_at DESC
  LIMIT 1
) profitability
WHERE link.active = true
  AND link.availability_authoritative = true;

COMMIT;
