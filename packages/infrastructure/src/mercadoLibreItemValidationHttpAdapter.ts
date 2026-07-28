import { createHash } from "node:crypto";
import {
  MercadoLibreRemoteError,
  type MercadoLibreItemValidationCause,
  type MercadoLibreItemValidationClientPort,
  type MercadoLibreItemValidationDraft,
  type MercadoLibreRemoteItemValidationResult,
} from "@eauto/application";

export type MercadoLibreItemValidationHttpAdapterConfig = Readonly<{
  apiBaseUrl: string;
  timeoutMs: number;
  maximumResponseBytes: number;
}>;

export class MercadoLibreItemValidationHttpAdapter
  implements MercadoLibreItemValidationClientPort
{
  constructor(private readonly config: MercadoLibreItemValidationHttpAdapterConfig) {}

  async validateItemDraft(
    draft: MercadoLibreItemValidationDraft,
    accessToken: string,
  ): Promise<MercadoLibreRemoteItemValidationResult> {
    const requestBody = toRemoteDraft(draft);
    const path = "/items/validate";
    try {
      const response = await fetch(new URL(path, this.config.apiBaseUrl), {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (response.status === 204) {
        return Object.freeze({
          status: "valid",
          causes: Object.freeze([]),
          sourceHash: hashPayload({ requestBody, responseStatus: 204 }),
        });
      }

      const responseText = await readBoundedText(response, this.config.maximumResponseBytes);
      if (response.status === 400) {
        const payload = parseJson(responseText, path);
        return Object.freeze({
          status: "invalid",
          causes: Object.freeze(normalizeCauses(payload)),
          sourceHash: hashPayload({ requestBody, responseStatus: 400, responseBody: payload }),
        });
      }

      throw new MercadoLibreRemoteError(
        `MercadoLibre item validation failed (${response.status}): ${responseText.slice(0, 500)}`,
        response.status === 401,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new MercadoLibreRemoteError(
          `MercadoLibre item validation timed out after ${this.config.timeoutMs} ms.`,
        );
      }
      throw error;
    }
  }
}

function toRemoteDraft(draft: MercadoLibreItemValidationDraft): Readonly<Record<string, unknown>> {
  return Object.freeze({
    title: draft.title,
    category_id: draft.categoryId,
    price: draft.priceMinor,
    currency_id: draft.currencyId,
    available_quantity: draft.availableQuantity,
    buying_mode: draft.buyingMode,
    listing_type_id: draft.listingTypeId,
    attributes: draft.attributes.map(toRemoteAttribute),
    sale_terms: draft.saleTerms.map(toRemoteAttribute),
    pictures: draft.pictures.map((picture) => Object.freeze({ source: picture.source })),
    shipping: Object.freeze({
      mode: draft.shipping.mode,
      local_pick_up: draft.shipping.localPickup,
      free_shipping: draft.shipping.freeShipping,
    }),
  });
}

function toRemoteAttribute(
  attribute: MercadoLibreItemValidationDraft["attributes"][number],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: attribute.id,
    ...(attribute.valueId === null ? {} : { value_id: attribute.valueId }),
    ...(attribute.valueName === null ? {} : { value_name: attribute.valueName }),
  });
}

function normalizeCauses(payload: unknown): MercadoLibreItemValidationCause[] {
  const response = asRecord(payload, "item validation response");
  const rawCauses = response.cause;
  if (!Array.isArray(rawCauses)) {
    throw new Error("MercadoLibre item validation response cause must be an array.");
  }
  return rawCauses.map((rawCause, index) => {
    const cause = asRecord(rawCause, `item validation cause[${index}]`);
    const references = cause.references;
    if (!Array.isArray(references) || references.some((value) => typeof value !== "string")) {
      throw new Error(`MercadoLibre item validation cause[${index}] references must be strings.`);
    }
    return Object.freeze({
      department: readOptionalString(cause, "department"),
      causeId: readOptionalStringOrNumber(cause, "cause_id"),
      type: readString(cause, "type"),
      code: readString(cause, "code"),
      references: Object.freeze([...references]),
      message: readString(cause, "message"),
    });
  });
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("maximumResponseBytes must be a positive safe integer.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maximumBytes) {
    throw new Error("MercadoLibre item validation response exceeds the configured byte limit.");
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maximumBytes) {
    throw new Error("MercadoLibre item validation response exceeds the configured byte limit.");
  }
  return new TextDecoder().decode(buffer);
}

function parseJson(value: string, path: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`MercadoLibre item validation returned invalid JSON for ${path}.`);
  }
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`MercadoLibre ${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MercadoLibre item validation field ${key} must be a non-empty string.`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`MercadoLibre item validation field ${key} must be a string.`);
  }
  return value;
}

function readOptionalStringOrNumber(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`MercadoLibre item validation field ${key} must be a string or number.`);
  }
  return String(value);
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
