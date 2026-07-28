import { createHash } from "node:crypto";
import type { ForReadingMercadoLibreTaxonomy } from "@eauto/application";
import type {
  MercadoLibreCategoryAttributeContract,
  MercadoLibreCategoryAttributesContract,
  MercadoLibreCategoryContract,
} from "@eauto/domain";

export type MercadoLibreTaxonomyHttpReaderConfig = Readonly<{
  apiBaseUrl: string;
  timeoutMs: number;
  maximumResponseBytes: number;
}>;

export class MercadoLibreTaxonomyHttpReader implements ForReadingMercadoLibreTaxonomy {
  constructor(
    private readonly config: MercadoLibreTaxonomyHttpReaderConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getCategory(input: {
    organizationId: string;
    accountId: string;
    categoryId: string;
  }): Promise<MercadoLibreCategoryContract | null> {
    validateScope(input.organizationId, input.accountId);
    validateCategoryId(input.categoryId);
    const payload = await this.getJson(`/categories/${encodeURIComponent(input.categoryId)}`);
    const category = asRecord(payload, "category");
    if (readString(category, "id") !== input.categoryId) {
      throw new Error("MercadoLibre category response does not match the requested category.");
    }
    const settings = asRecord(category.settings, "category.settings");
    const pathFromRoot = readNamedIds(category.path_from_root, "category.path_from_root");
    const children = readNamedIds(category.children_categories, "category.children_categories");
    const observedAt = this.now().toISOString();
    const listingAllowed = readBoolean(settings, "listing_allowed");
    return Object.freeze({
      id: input.categoryId,
      siteId: categorySiteId(input.categoryId),
      name: readString(category, "name"),
      pathFromRoot: Object.freeze(pathFromRoot),
      childrenCategoryIds: Object.freeze(children.map((child) => child.id)),
      listingAllowed,
      status: listingAllowed ? "enabled" : "disabled",
      evidence: Object.freeze({ observedAt, sourceHash: hashPayload(payload) }),
    });
  }

  async getCategoryAttributes(input: {
    organizationId: string;
    accountId: string;
    categoryId: string;
  }): Promise<MercadoLibreCategoryAttributesContract | null> {
    validateScope(input.organizationId, input.accountId);
    validateCategoryId(input.categoryId);
    const payload = await this.getJson(
      `/categories/${encodeURIComponent(input.categoryId)}/attributes`,
    );
    if (!Array.isArray(payload)) throw new Error("MercadoLibre category attributes must be an array.");
    const attributes = payload.map((value, index) => normalizeAttribute(value, index));
    return Object.freeze({
      categoryId: input.categoryId,
      attributes: Object.freeze(attributes),
      evidence: Object.freeze({
        observedAt: this.now().toISOString(),
        sourceHash: hashPayload(payload),
      }),
    });
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await fetch(new URL(path, this.config.apiBaseUrl), {
      redirect: "error",
      signal: AbortSignal.timeout(this.config.timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      const text = (await readBoundedText(response, this.config.maximumResponseBytes)).slice(0, 500);
      throw new Error(`MercadoLibre taxonomy read failed (${response.status}) for ${path}: ${text}`);
    }
    const text = await readBoundedText(response, this.config.maximumResponseBytes);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`MercadoLibre taxonomy returned invalid JSON for ${path}.`);
    }
  }
}

function normalizeAttribute(value: unknown, index: number): MercadoLibreCategoryAttributeContract {
  const attribute = asRecord(value, `attribute[${index}]`);
  const tags = optionalRecord(attribute.tags);
  const allowedValues = Array.isArray(attribute.values)
    ? attribute.values.map((allowed, allowedIndex) => {
        const normalized = asRecord(allowed, `attribute[${index}].values[${allowedIndex}]`);
        return Object.freeze({ id: readStringOrNumber(normalized, "id"), name: readString(normalized, "name") });
      })
    : [];
  return Object.freeze({
    id: readString(attribute, "id"),
    name: readString(attribute, "name"),
    valueType: readValueType(attribute),
    required: tags?.required === true,
    fixed: tags?.fixed === true,
    allowedValues: Object.freeze(allowedValues),
  });
}

function readValueType(attribute: Record<string, unknown>): MercadoLibreCategoryAttributeContract["valueType"] {
  const value = readString(attribute, "value_type");
  if (["string", "number", "list", "boolean", "number_unit"].includes(value)) {
    return value as MercadoLibreCategoryAttributeContract["valueType"];
  }
  throw new Error(`Unsupported MercadoLibre attribute value_type ${value}.`);
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("maximumResponseBytes must be a positive safe integer.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maximumBytes) {
    throw new Error("MercadoLibre taxonomy response exceeds the configured byte limit.");
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maximumBytes) {
    throw new Error("MercadoLibre taxonomy response exceeds the configured byte limit.");
  }
  return new TextDecoder().decode(buffer);
}

function readNamedIds(value: unknown, field: string): ReadonlyArray<Readonly<{ id: string; name: string }>> {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((entry, index) => {
    const record = asRecord(entry, `${field}[${index}]`);
    return Object.freeze({ id: readString(record, "id"), name: readString(record, "name") });
  });
}

function validateScope(organizationId: string, accountId: string): void {
  if (!organizationId.trim() || !accountId.trim()) throw new Error("Organization and account scope are required.");
}

function validateCategoryId(categoryId: string): void {
  if (!/^MLC\d+$/.test(categoryId)) throw new Error("MercadoLibre Chile category ID is invalid.");
}

function categorySiteId(categoryId: string): string {
  return categoryId.slice(0, 3);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value;
}

function readStringOrNumber(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    throw new Error(`${field} must be a string or number.`);
  }
  return String(value);
}

function readBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean.`);
  return value;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
