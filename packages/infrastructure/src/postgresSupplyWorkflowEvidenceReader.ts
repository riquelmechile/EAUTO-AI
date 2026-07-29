import type { Pool } from "pg";
import type { SupplyWorkflowEvidenceReader } from "@eauto/application";

export class PostgresSupplyWorkflowEvidenceReader implements SupplyWorkflowEvidenceReader {
  constructor(private readonly pool: Pool) {}

  async read(input: {
    organizationId: string;
    accountId: string;
    supplierId: string;
    listingId: string | null;
    asOf: string;
    maximumAgeMs: number;
  }): Promise<
    Readonly<{
      availableKinds: readonly string[];
      evidenceRefs: readonly string[];
      missingInputs: readonly string[];
    }>
  > {
    const [supplier, listing, profitability, policy, landedCost] = await Promise.all([
      this.readSupplier(input),
      input.listingId ? this.readListing(input) : Promise.resolve(null),
      input.listingId ? this.readProfitability(input) : Promise.resolve(null),
      input.listingId ? this.readPolicy(input) : Promise.resolve(null),
      input.listingId ? this.readLandedCost(input) : Promise.resolve(null),
    ]);
    const availableKinds = new Set<string>();
    const evidenceRefs = new Set<string>();
    const missingInputs = new Set<string>();

    if (supplier) {
      const supplierFresh = isFresh(supplier.observedAt, input.asOf, input.maximumAgeMs);
      if (supplierFresh && supplier.syncSucceeded) {
        availableKinds.add("supplier-evidence");
        evidenceRefs.add(
          `supplier-product:${supplier.sourceId}:${supplier.sku}:${supplier.contentHash}`,
        );
      } else {
        missingInputs.add(supplierFresh ? "supplier-sync" : "fresh-supplier-evidence");
      }
      if (supplierFresh) {
        availableKinds.add("inventory-snapshot");
        evidenceRefs.add(
          `supplier-stock:${supplier.sourceId}:${supplier.sku}:${supplier.stockQty}`,
        );
      }
    } else {
      missingInputs.add("supplier-evidence");
    }

    if (input.listingId) {
      if (listing && isFresh(listing.observedAt, input.asOf, input.maximumAgeMs)) {
        availableKinds.add("listing-snapshot");
        availableKinds.add("inventory-snapshot");
        evidenceRefs.add(`listing:${listing.itemId}:${listing.contentHash}`);
      } else {
        missingInputs.add("fresh-listing-snapshot");
      }
      if (profitability && isFresh(profitability.calculatedAt, input.asOf, input.maximumAgeMs)) {
        availableKinds.add("economic-snapshot");
        evidenceRefs.add(`profitability:${profitability.id}:${profitability.contentHash}`);
      } else {
        missingInputs.add("fresh-economic-snapshot");
      }
      if (policy?.policyVersion) {
        availableKinds.add("policy-version");
        evidenceRefs.add(`supplier-policy:${policy.policyVersion}`);
      } else {
        missingInputs.add("policy-version");
      }
      if (landedCost) {
        availableKinds.add("landed-cost-evidence");
        evidenceRefs.add(`economic-cost:${landedCost.id}:${landedCost.contentHash}`);
      }
    }

    return Object.freeze({
      availableKinds: Object.freeze([...availableKinds].sort()),
      evidenceRefs: Object.freeze([...evidenceRefs].sort()),
      missingInputs: Object.freeze([...missingInputs].sort()),
    });
  }

  private async readSupplier(input: {
    organizationId: string;
    accountId: string;
    supplierId: string;
    listingId: string | null;
  }): Promise<Readonly<{
    sourceId: string;
    sku: string;
    stockQty: number;
    syncSucceeded: boolean;
    observedAt: string;
    contentHash: string;
  }> | null> {
    const result = await this.pool.query<{
      supplier_source_id: string;
      sku: string;
      stock_qty: string;
      sync_succeeded: boolean;
      observed_at: Date | string;
      current_content_hash: string;
    }>(
      `SELECT product.supplier_source_id,product.sku,product.stock_qty::text,
              product.sync_succeeded,product.observed_at,product.current_content_hash
       FROM supplier_products product
       LEFT JOIN supplier_listing_links link
         ON link.organization_id=product.organization_id
        AND link.account_id=product.account_id
        AND link.supplier_source_id=product.supplier_source_id
        AND link.sku=product.sku
       WHERE product.organization_id=$1 AND product.account_id=$2
         AND product.supplier_source_id=$3
         AND ($4::text IS NULL OR (link.listing_id=$4 AND link.active=true))
       ORDER BY product.observed_at DESC LIMIT 1`,
      [input.organizationId, input.accountId, input.supplierId, input.listingId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return Object.freeze({
      sourceId: row.supplier_source_id,
      sku: row.sku,
      stockQty: safeInteger(row.stock_qty, "supplier stock"),
      syncSucceeded: row.sync_succeeded,
      observedAt: iso(row.observed_at),
      contentHash: row.current_content_hash,
    });
  }

  private async readListing(input: {
    organizationId: string;
    accountId: string;
    listingId: string | null;
  }) {
    const result = await this.pool.query<{
      item_id: string;
      observed_at: Date | string;
      content_hash: string;
    }>(
      `SELECT item_id,observed_at,content_hash
       FROM mercadolibre_listing_snapshots
       WHERE organization_id=$1 AND account_id=$2 AND item_id=$3 LIMIT 1`,
      [input.organizationId, input.accountId, input.listingId],
    );
    const row = result.rows[0];
    return row
      ? Object.freeze({
          itemId: row.item_id,
          observedAt: iso(row.observed_at),
          contentHash: row.content_hash,
        })
      : null;
  }

  private async readProfitability(input: {
    organizationId: string;
    accountId: string;
    listingId: string | null;
  }) {
    const result = await this.pool.query<{
      id: string;
      calculated_at: Date | string;
      content_hash: string;
    }>(
      `SELECT id,calculated_at,content_hash
       FROM profitability_snapshots
       WHERE organization_id=$1 AND account_id=$2 AND listing_id=$3
       ORDER BY calculated_at DESC LIMIT 1`,
      [input.organizationId, input.accountId, input.listingId],
    );
    const row = result.rows[0];
    return row
      ? Object.freeze({
          id: row.id,
          calculatedAt: iso(row.calculated_at),
          contentHash: row.content_hash,
        })
      : null;
  }

  private async readPolicy(input: {
    organizationId: string;
    accountId: string;
    supplierId: string;
    listingId: string | null;
  }) {
    const result = await this.pool.query<{ policy_version: string }>(
      `SELECT policy_version FROM supplier_listing_links
       WHERE organization_id=$1 AND account_id=$2 AND supplier_source_id=$3
         AND listing_id=$4 AND active=true
       ORDER BY updated_at DESC LIMIT 1`,
      [input.organizationId, input.accountId, input.supplierId, input.listingId],
    );
    const row = result.rows[0];
    return row ? Object.freeze({ policyVersion: row.policy_version }) : null;
  }

  private async readLandedCost(input: {
    organizationId: string;
    accountId: string;
    listingId: string | null;
  }) {
    const result = await this.pool.query<{
      id: string;
      content_hash: string;
    }>(
      `SELECT id,content_hash FROM economic_cost_observations
       WHERE organization_id=$1 AND account_id=$2 AND listing_id=$3
         AND cost_kind='landed-cost'
       ORDER BY observed_at DESC LIMIT 1`,
      [input.organizationId, input.accountId, input.listingId],
    );
    const row = result.rows[0];
    return row ? Object.freeze({ id: row.id, contentHash: row.content_hash }) : null;
  }
}

function isFresh(observedAt: string, asOf: string, maximumAgeMs: number): boolean {
  const age = Date.parse(asOf) - Date.parse(observedAt);
  return Number.isFinite(age) && age >= 0 && age <= maximumAgeMs;
}

function safeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeded safe integer range.`);
  return parsed;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
