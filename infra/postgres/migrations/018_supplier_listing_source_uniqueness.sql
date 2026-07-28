BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_listing_links_source_scope_idx
  ON supplier_listing_links(account_id, listing_id, supplier_source_id);

COMMIT;
