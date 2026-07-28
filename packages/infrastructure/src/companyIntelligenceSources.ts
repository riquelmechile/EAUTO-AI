import type { Pool } from "pg";
import type {
  AccountBrainDimension,
  AccountBrainFinding,
  EvidenceDocument,
  EvidenceSubject,
  MercadoLibreListingSnapshot,
  MercadoLibreOrderSnapshot,
  ProductLifecycleInput,
  SemanticMemorySearchResult,
  Signal,
  SpecialistDaemonDefinition,
} from "@eauto/domain";
import type {
  AccountBrainSource,
  EvidenceResponder,
  OperationalEvidenceReader,
  ProductLifecycleSource,
  SemanticMemoryService,
  SpecialistDaemonSignalProvider,
  SupplyWorkflowEvidenceReader,
} from "@eauto/application";

export class OperationalEvidenceResponder implements EvidenceResponder {
  readonly id = "verified-operational-read-model";
  readonly subjects = Object.freeze([
    "catalog",
    "customer",
    "commercial",
    "economic",
    "reputation",
    "content",
    "system",
  ] as const satisfies readonly EvidenceSubject[]);

  constructor(private readonly reader: OperationalEvidenceReader) {}

  respond(input: {
    organizationId: string;
    accountId: string;
    subject: EvidenceSubject;
    purpose: string;
    requiredKinds: readonly string[];
    asOf: string;
    maximumAgeMs: number;
  }): Promise<
    Readonly<{ documents: readonly EvidenceDocument[]; missingInputs: readonly string[] }>
  > {
    return this.reader.read(input);
  }
}

export class OperationalAccountBrainSource implements AccountBrainSource {
  constructor(
    private readonly reader: OperationalEvidenceReader,
    private readonly memory: SemanticMemoryService,
  ) {}

  async readDimension(input: {
    organizationId: string;
    accountId: string;
    dimension: AccountBrainDimension;
    asOf: string;
    maximumAgeMs: number;
  }): Promise<
    Readonly<{
      scoreBps: number | null;
      evidenceRefs: readonly string[];
      missingInputs: readonly string[];
      findings: readonly Omit<AccountBrainFinding, "id" | "dimension" | "memoryRefs">[];
    }>
  > {
    const subject = subjectForDimension(input.dimension);
    const result = await this.reader.read({ ...input, subject });
    const evidenceRefs = Object.freeze(result.documents.map((document) => document.reference.id));
    const findings: Omit<AccountBrainFinding, "id" | "dimension" | "memoryRefs">[] = [];
    for (const document of result.documents) {
      const payload = asRecord(document.payload);
      const status = typeof payload?.status === "string" ? payload.status : null;
      const marginBps = typeof payload?.marginBps === "number" ? payload.marginBps : null;
      if (status === "incomplete") {
        findings.push(
          finding(
            "incomplete-read-model",
            "Incomplete operational snapshot",
            "A current source declares missing inputs.",
            "warning",
            document,
          ),
        );
      }
      if (marginBps !== null && marginBps < 0) {
        findings.push(
          finding(
            "negative-margin",
            "Negative margin detected",
            "Verified economic evidence contains a negative margin.",
            "critical",
            document,
          ),
        );
      }
    }
    const missingInputs = Object.freeze([...new Set(result.missingInputs)].sort());
    const scoreBps =
      result.documents.length === 0 || missingInputs.length > 0
        ? null
        : Math.max(
            0,
            9_000 -
              findings.filter((entry) => entry.severity === "warning").length * 1_500 -
              findings.filter((entry) => entry.severity === "critical").length * 4_000,
          );
    return Object.freeze({
      scoreBps,
      evidenceRefs,
      missingInputs,
      findings: Object.freeze(findings),
    });
  }

  retrieveMemory(input: {
    organizationId: string;
    accountId: string;
    query: string;
    limit: number;
  }): Promise<readonly SemanticMemorySearchResult[]> {
    return this.memory.retrieve(input);
  }
}

export class OperationalSpecialistDaemonSignalProvider implements SpecialistDaemonSignalProvider {
  constructor(private readonly reader: OperationalEvidenceReader) {}

  async readSignals(input: {
    organizationId: string;
    accountId: string;
    definition: SpecialistDaemonDefinition;
    asOf: string;
  }): Promise<readonly Signal[]> {
    const result = await this.reader.read({
      organizationId: input.organizationId,
      accountId: input.accountId,
      subject: input.definition.evidenceSubject,
      asOf: input.asOf,
      maximumAgeMs: input.definition.maximumEvidenceAgeMs,
    });
    return Object.freeze(
      result.documents.map((document) =>
        Object.freeze({
          kind: `daemon:${input.definition.id}:${document.kind ?? document.subject}`,
          entityId: document.reference.sourceRecordId,
          observedAt: document.reference.observedAt,
          materialValue: document.reference.contentHash,
          urgency: urgencyFor(document),
          expectedImpact: input.definition.id === "claims-reputation" ? 0.9 : 0.6,
          confidence: document.reference.confidence === "high" ? 0.95 : 0.7,
        }),
      ),
    );
  }
}

export class OperationalSupplyWorkflowEvidenceReader implements SupplyWorkflowEvidenceReader {
  constructor(private readonly reader: OperationalEvidenceReader) {}

  async read(input: {
    organizationId: string;
    accountId: string;
    supplierId: string;
    listingId: string | null;
    asOf: string;
    maximumAgeMs: number;
  }) {
    const subjects = ["economic", "catalog", "commercial"] as const;
    const results = await Promise.all(
      subjects.map((subject) =>
        this.reader.read({
          organizationId: input.organizationId,
          accountId: input.accountId,
          subject,
          asOf: input.asOf,
          maximumAgeMs: input.maximumAgeMs,
        }),
      ),
    );
    return Object.freeze({
      availableKinds: Object.freeze(
        [
          ...new Set(
            results.flatMap((result) =>
              result.documents.flatMap((document) => (document.kind ? [document.kind] : [])),
            ),
          ),
        ].sort(),
      ),
      evidenceRefs: Object.freeze(
        [
          ...new Set(
            results.flatMap((result) => result.documents.map((document) => document.reference.id)),
          ),
        ].sort(),
      ),
      missingInputs: Object.freeze(
        [...new Set(results.flatMap((result) => result.missingInputs))].sort(),
      ),
    });
  }
}

export class PostgresProductLifecycleSource implements ProductLifecycleSource {
  constructor(
    private readonly pool: Pool,
    private readonly maximumEvidenceAgeMs: number,
  ) {}

  async readLifecycleInput(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
    asOf: string;
  }): Promise<Omit<ProductLifecycleInput, "organizationId" | "accountId" | "listingId" | "asOf">> {
    const listingResult = await this.pool.query<{ payload_json: MercadoLibreListingSnapshot }>(
      `SELECT payload_json FROM mercadolibre_listing_snapshots
       WHERE organization_id=$1 AND account_id=$2 AND item_id=$3 LIMIT 1`,
      [input.organizationId, input.accountId, input.listingId],
    );
    const listing = listingResult.rows[0]?.payload_json ?? null;
    const ordersResult = await this.pool.query<{
      units_30d: string;
      units_90d: string;
      last_sale_at: Date | string | null;
      evidence_refs: string[];
    }>(
      `SELECT
         coalesce(sum(CASE WHEN date_created >= $4::timestamptz - interval '30 days' THEN (payload_json->>'unitCount')::bigint ELSE 0 END),0)::text AS units_30d,
         coalesce(sum(CASE WHEN date_created >= $4::timestamptz - interval '90 days' THEN (payload_json->>'unitCount')::bigint ELSE 0 END),0)::text AS units_90d,
         max(date_created) FILTER (WHERE payload_json->'itemIds' ? $3) AS last_sale_at,
         coalesce(array_agg('order:' || order_id) FILTER (WHERE payload_json->'itemIds' ? $3),'{}') AS evidence_refs
       FROM mercadolibre_order_snapshots
       WHERE organization_id=$1 AND account_id=$2 AND payload_json->'itemIds' ? $3`,
      [input.organizationId, input.accountId, input.listingId, input.asOf],
    );
    const profitabilityResult = await this.pool.query<{
      margin_bps: number | null;
      calculated_at: Date | string;
      id: string;
    }>(
      `SELECT (payload_json->>'marginBps')::integer AS margin_bps,calculated_at,id
       FROM profitability_snapshots
       WHERE organization_id=$1 AND account_id=$2 AND listing_id=$3
       ORDER BY calculated_at DESC LIMIT 1`,
      [input.organizationId, input.accountId, input.listingId],
    );
    const orderRow = ordersResult.rows[0];
    const profitability = profitabilityResult.rows[0];
    const evidenceRefs = Object.freeze([
      ...(listing ? [`listing:${listing.itemId}`] : []),
      ...(orderRow?.evidence_refs ?? []),
      ...(profitability ? [`profitability:${profitability.id}`] : []),
    ]);
    const observedTimes = [
      listing?.observedAt,
      profitability ? iso(profitability.calculated_at) : null,
    ].filter((value): value is string => value !== null && value !== undefined);
    const evidenceFresh =
      observedTimes.length > 0 &&
      observedTimes.every(
        (observedAt) =>
          Date.parse(input.asOf) - Date.parse(observedAt) <= this.maximumEvidenceAgeMs,
      );
    return Object.freeze({
      listingActive: listing ? listing.status === "active" : null,
      availableQuantity: listing?.availableQuantity ?? null,
      soldUnits30d: orderRow ? safeInteger(orderRow.units_30d, "units30d") : null,
      soldUnits90d: orderRow ? safeInteger(orderRow.units_90d, "units90d") : null,
      visits30d: null,
      lastSaleAt: orderRow?.last_sale_at ? iso(orderRow.last_sale_at) : null,
      marginBps: profitability?.margin_bps ?? null,
      seasonInWindow: null,
      seasonEvidenceConfidence: null,
      evidenceFresh,
      evidenceRefs,
    });
  }

  async listListingIds(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly string[]> {
    const result = await this.pool.query<{ item_id: string }>(
      `SELECT item_id FROM mercadolibre_listing_snapshots
       WHERE organization_id=$1 AND account_id=$2 ORDER BY item_id ASC LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return Object.freeze(result.rows.map((row) => row.item_id));
  }
}

function subjectForDimension(dimension: AccountBrainDimension): EvidenceSubject {
  if (dimension === "catalog") return "catalog";
  if (dimension === "customers") return "customer";
  if (dimension === "content") return "content";
  if (dimension === "reputation") return "reputation";
  if (dimension === "supply") return "economic";
  if (dimension === "advertising") return "economic";
  return "economic";
}

function finding(
  kind: string,
  title: string,
  summary: string,
  severity: "warning" | "critical",
  document: EvidenceDocument,
): Omit<AccountBrainFinding, "id" | "dimension" | "memoryRefs"> {
  return Object.freeze({
    kind,
    title,
    summary,
    severity,
    confidence: document.reference.confidence,
    evidenceRefs: Object.freeze([document.reference.id]),
  });
}

function urgencyFor(document: EvidenceDocument): number {
  const payload = asRecord(document.payload);
  const status = typeof payload?.status === "string" ? payload.status : "";
  if (status === "incomplete" || status === "failed" || status === "open") return 0.9;
  return 0.55;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeded safe integer range.`);
  return parsed;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
