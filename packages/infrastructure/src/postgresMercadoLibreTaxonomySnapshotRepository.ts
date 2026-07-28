import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  ForPersistingMercadoLibreTaxonomySnapshots,
  ForReadingMercadoLibreTaxonomy,
  MercadoLibreTaxonomyScope,
} from "@eauto/application";
import type {
  MercadoLibreCategoryAttributeContract,
  MercadoLibreCategoryAttributesContract,
  MercadoLibreCategoryContract,
  MercadoLibreTaxonomyEvidence,
} from "@eauto/domain";

export class PostgresMercadoLibreTaxonomySnapshotRepository
  implements ForReadingMercadoLibreTaxonomy, ForPersistingMercadoLibreTaxonomySnapshots
{
  constructor(private readonly pool: Pool) {}

  async getCategory(
    input: MercadoLibreTaxonomyScope,
  ): Promise<MercadoLibreCategoryContract | null> {
    validateScope(input);
    const payload = await this.readLatest(input, "category");
    return payload === null ? null : freezeCategory(payload, input.categoryId);
  }

  async getCategoryAttributes(
    input: MercadoLibreTaxonomyScope,
  ): Promise<MercadoLibreCategoryAttributesContract | null> {
    validateScope(input);
    const payload = await this.readLatest(input, "attributes");
    return payload === null ? null : freezeAttributes(payload, input.categoryId);
  }

  async saveCategory(
    input: MercadoLibreTaxonomyScope & Readonly<{ snapshot: MercadoLibreCategoryContract }>,
  ): Promise<void> {
    validateScope(input);
    const snapshot = freezeCategory(input.snapshot, input.categoryId);
    await this.saveSnapshot(input, "category", snapshot);
  }

  async saveCategoryAttributes(
    input: MercadoLibreTaxonomyScope &
      Readonly<{ snapshot: MercadoLibreCategoryAttributesContract }>,
  ): Promise<void> {
    validateScope(input);
    const snapshot = freezeAttributes(input.snapshot, input.categoryId);
    await this.saveSnapshot(input, "attributes", snapshot);
  }

  private async readLatest(
    input: MercadoLibreTaxonomyScope,
    kind: "category" | "attributes",
  ): Promise<unknown | null> {
    const result = await this.pool.query<{ payload_json: unknown }>(
      `SELECT payload_json
       FROM mercadolibre_taxonomy_snapshots
       WHERE organization_id = $1 AND account_id = $2
         AND category_id = $3 AND snapshot_kind = $4
       ORDER BY observed_at DESC, created_at DESC, id DESC
       LIMIT 1`,
      [input.organizationId, input.accountId, input.categoryId, kind],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  private async saveSnapshot(
    input: MercadoLibreTaxonomyScope,
    kind: "category" | "attributes",
    snapshot: MercadoLibreCategoryContract | MercadoLibreCategoryAttributesContract,
  ): Promise<void> {
    validateEvidence(snapshot.evidence);
    const sourceHash = snapshot.evidence.sourceHash;
    const snapshotId = `mercadolibre-taxonomy-snapshot-${hashCanonical({
      organizationId: input.organizationId,
      accountId: input.accountId,
      categoryId: input.categoryId,
      kind,
      sourceHash,
    })}`;
    const inserted = await this.pool.query(
      `INSERT INTO mercadolibre_taxonomy_snapshots
        (id, organization_id, account_id, category_id, snapshot_kind,
         source_hash, observed_at, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (organization_id, account_id, category_id, snapshot_kind, source_hash)
       DO NOTHING`,
      [
        snapshotId,
        input.organizationId,
        input.accountId,
        input.categoryId,
        kind,
        sourceHash,
        snapshot.evidence.observedAt,
        JSON.stringify(snapshot),
      ],
    );
    if (inserted.rowCount === 1) return;

    const existing = await this.pool.query<{ payload_json: unknown }>(
      `SELECT payload_json
       FROM mercadolibre_taxonomy_snapshots
       WHERE organization_id = $1 AND account_id = $2
         AND category_id = $3 AND snapshot_kind = $4 AND source_hash = $5`,
      [input.organizationId, input.accountId, input.categoryId, kind, sourceHash],
    );
    const existingPayload = existing.rows[0]?.payload_json;
    if (
      existingPayload === undefined ||
      hashCanonical(existingPayload) !== hashCanonical(snapshot)
    ) {
      throw new Error("MercadoLibre taxonomy snapshot source hash conflicts with another payload.");
    }
  }
}

function freezeCategory(value: unknown, expectedCategoryId: string): MercadoLibreCategoryContract {
  const record = asRecord(value, "MercadoLibre category snapshot");
  const id = readString(record, "id");
  if (id !== expectedCategoryId || readString(record, "siteId") !== "MLC") {
    throw new Error("MercadoLibre category snapshot is outside the requested Chile category.");
  }
  const status = readString(record, "status");
  if (status !== "enabled" && status !== "disabled") {
    throw new Error("MercadoLibre category snapshot status is invalid.");
  }
  return Object.freeze({
    id,
    siteId: "MLC",
    name: readString(record, "name"),
    pathFromRoot: Object.freeze(readNamedValues(record.pathFromRoot, "pathFromRoot")),
    childrenCategoryIds: Object.freeze(
      readStringArray(record.childrenCategoryIds, "childrenCategoryIds"),
    ),
    listingAllowed: readBoolean(record, "listingAllowed"),
    status,
    evidence: freezeEvidence(record.evidence),
  });
}

function freezeAttributes(
  value: unknown,
  expectedCategoryId: string,
): MercadoLibreCategoryAttributesContract {
  const record = asRecord(value, "MercadoLibre category attributes snapshot");
  const categoryId = readString(record, "categoryId");
  if (categoryId !== expectedCategoryId) {
    throw new Error("MercadoLibre attribute snapshot is outside the requested category.");
  }
  if (!Array.isArray(record.attributes)) {
    throw new Error("MercadoLibre attribute snapshot attributes must be an array.");
  }
  return Object.freeze({
    categoryId,
    attributes: Object.freeze(
      record.attributes.map((attribute, index) => freezeAttribute(attribute, index)),
    ),
    evidence: freezeEvidence(record.evidence),
  });
}

function freezeAttribute(value: unknown, index: number): MercadoLibreCategoryAttributeContract {
  const record = asRecord(value, `MercadoLibre attribute snapshot[${index}]`);
  const valueType = readString(record, "valueType");
  if (!["string", "number", "list", "boolean", "number_unit"].includes(valueType)) {
    throw new Error(`MercadoLibre attribute snapshot[${index}] valueType is invalid.`);
  }
  return Object.freeze({
    id: readString(record, "id"),
    name: readString(record, "name"),
    valueType: valueType as MercadoLibreCategoryAttributeContract["valueType"],
    required: readBoolean(record, "required"),
    fixed: readBoolean(record, "fixed"),
    allowedValues: Object.freeze(
      readNamedValues(record.allowedValues, `attribute[${index}].allowedValues`),
    ),
  });
}

function freezeEvidence(value: unknown): MercadoLibreTaxonomyEvidence {
  const record = asRecord(value, "MercadoLibre taxonomy evidence");
  const evidence = Object.freeze({
    observedAt: readString(record, "observedAt"),
    sourceHash: readString(record, "sourceHash"),
  });
  validateEvidence(evidence);
  return evidence;
}

function validateEvidence(evidence: MercadoLibreTaxonomyEvidence): void {
  if (!/^[a-f0-9]{64}$/.test(evidence.sourceHash)) {
    throw new Error("MercadoLibre taxonomy sourceHash must be a lowercase SHA-256 digest.");
  }
  if (Number.isNaN(new Date(evidence.observedAt).getTime())) {
    throw new Error("MercadoLibre taxonomy observedAt must be a valid date.");
  }
}

function validateScope(input: MercadoLibreTaxonomyScope): void {
  if (!input.organizationId.trim() || !input.accountId.trim()) {
    throw new Error("MercadoLibre taxonomy organization and account scope are required.");
  }
  if (!/^MLC\d+$/.test(input.categoryId)) {
    throw new Error("MercadoLibre taxonomy categoryId must identify a Chile category.");
  }
}

function readNamedValues(
  value: unknown,
  field: string,
): ReadonlyArray<Readonly<{ id: string; name: string }>> {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((entry, index) => {
    const record = asRecord(entry, `${field}[${index}]`);
    return Object.freeze({ id: readString(record, "id"), name: readString(record, "name") });
  });
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be a string array.`);
  }
  return [...value];
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean.`);
  return value;
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}
