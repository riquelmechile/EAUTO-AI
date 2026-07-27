import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { EvidenceDocument, EvidenceSubject } from "@eauto/domain";
import type { OperationalEvidenceReader } from "@eauto/application";

export class VerifiedOperationalEvidenceReader implements OperationalEvidenceReader {
  constructor(private readonly pool: Pool) {}

  async read(input: {
    organizationId: string;
    accountId: string;
    subject: EvidenceSubject;
    asOf: string;
    maximumAgeMs: number;
  }): Promise<
    Readonly<{ documents: readonly EvidenceDocument[]; missingInputs: readonly string[] }>
  > {
    const minimumObservedAt = new Date(Date.parse(input.asOf) - input.maximumAgeMs).toISOString();
    const rows = await readRows(
      this.pool,
      input.subject,
      input.organizationId,
      input.accountId,
      minimumObservedAt,
    );
    const expiresAt = new Date(Date.parse(input.asOf) + input.maximumAgeMs).toISOString();
    const documents = Object.freeze(
      rows.map((row) =>
        Object.freeze({
          reference: Object.freeze({
            id: `${row.kind}:${row.source_id}`,
            source: row.source,
            sourceRecordId: row.source_id,
            observedAt: row.observed_at,
            freshness: "fresh" as const,
            confidence: "high" as const,
            contentHash: hashJson(row.payload_json),
          }),
          subject: input.subject,
          kind: row.kind,
          authority: "authoritative" as const,
          expiresAt,
          payload: row.payload_json,
        }),
      ),
    );
    return Object.freeze({
      documents,
      missingInputs:
        documents.length === 0 ? Object.freeze([`${input.subject}-read-model`]) : Object.freeze([]),
    });
  }
}

type EvidenceRow = Readonly<{
  source: string;
  source_id: string;
  observed_at: string;
  kind: string;
  payload_json: unknown;
}>;

async function readRows(
  pool: Pool,
  subject: EvidenceSubject,
  organizationId: string,
  accountId: string,
  minimumObservedAt: string,
): Promise<readonly EvidenceRow[]> {
  const queryBySubject: Partial<Record<EvidenceSubject, string>> = {
    catalog: `SELECT 'mercadolibre-listing' AS source, item_id AS source_id,
              observed_at::text, 'listing-snapshot' AS kind, payload_json
              FROM mercadolibre_listing_snapshots
              WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
              ORDER BY observed_at DESC LIMIT 500`,
    customer: `SELECT source, source_id, observed_at::text, kind, payload_json FROM (
                 SELECT 'mercadolibre-claim' AS source, claim_id AS source_id,
                        observed_at, 'claim-snapshot' AS kind, payload_json
                 FROM mercadolibre_claim_snapshots
                 WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
                 UNION ALL
                 SELECT 'mercadolibre-question' AS source, question_id AS source_id,
                        observed_at, 'question-snapshot' AS kind, payload_json
                 FROM mercadolibre_question_snapshots
                 WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
               ) evidence ORDER BY observed_at DESC LIMIT 500`,
    commercial: `SELECT 'mercadolibre-order' AS source, order_id AS source_id,
                  observed_at::text, 'order-snapshot' AS kind, payload_json
                  FROM mercadolibre_order_snapshots
                  WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
                  ORDER BY observed_at DESC LIMIT 500`,
    reputation: `SELECT 'mercadolibre-reputation' AS source, seller_id AS source_id,
                  observed_at::text, 'reputation-snapshot' AS kind, payload_json
                  FROM mercadolibre_reputation_snapshots
                  WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
                  ORDER BY observed_at DESC LIMIT 1`,
    content: `SELECT 'content-asset' AS source, id AS source_id,
              created_at::text AS observed_at, 'content-asset' AS kind,
              jsonb_build_object(
                'id', id, 'productId', product_id, 'kind', kind, 'uri', uri,
                'contentHash', content_hash, 'provider', provider, 'model', model,
                'promptVersion', prompt_version, 'moderationStatus', moderation_status,
                'metadata', metadata_json
              ) AS payload_json
              FROM content_assets
              WHERE account_id = $2 AND created_at >= $3
              ORDER BY created_at DESC LIMIT 500`,
    economic: `SELECT 'verifiable-receipt' AS source, id AS source_id,
               recorded_at::text AS observed_at, 'economic-snapshot' AS kind, payload_json
               FROM verifiable_receipts
               WHERE account_id = $2
                 AND receipt_type IN ('economic-snapshot','profit-reconciliation','unit-economics')
                 AND recorded_at >= $3
               ORDER BY recorded_at DESC LIMIT 500`,
    system: `SELECT 'verifiable-receipt' AS source, id AS source_id,
             recorded_at::text AS observed_at, 'receipt-chain' AS kind, payload_json
             FROM verifiable_receipts
             WHERE account_id = $2 AND recorded_at >= $3
             ORDER BY recorded_at DESC LIMIT 500`,
  };
  const sql = queryBySubject[subject];
  if (!sql) return [];
  const result = await pool.query<EvidenceRow>(sql, [organizationId, accountId, minimumObservedAt]);
  return result.rows;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
