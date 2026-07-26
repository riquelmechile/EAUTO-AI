import { createHash } from "node:crypto";
import {
  MercadoLibreRemoteError,
  type MercadoLibreClientPort,
  type MercadoLibreRemoteClaim,
  type MercadoLibreRemoteListing,
  type MercadoLibreRemoteQuestion,
  type MercadoLibreRemoteUser,
  type MercadoLibreTokenSet,
} from "@eauto/application";

export type MercadoLibreHttpClientConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenUrl: string;
  apiBaseUrl: string;
  timeoutMs: number;
  maximumScanPages: number;
}>;

export class MercadoLibreHttpClient implements MercadoLibreClientPort {
  constructor(private readonly config: MercadoLibreHttpClientConfig) {}

  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<MercadoLibreTokenSet> {
    return this.requestToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: input.code,
        redirect_uri: this.config.redirectUri,
        code_verifier: input.codeVerifier,
      }),
    );
  }

  refreshAccessToken(refreshToken: string): Promise<MercadoLibreTokenSet> {
    return this.requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
      }),
    );
  }

  async getCurrentUser(accessToken: string): Promise<MercadoLibreRemoteUser> {
    const payload = asRecord(await this.getJson("/users/me", accessToken), "users/me");
    const id = readStringOrNumber(payload, "id");
    const siteId = readString(payload, "site_id");
    const nickname = readOptionalString(payload, "nickname");
    return Object.freeze({ id, ...(nickname ? { nickname } : {}), siteId });
  }

  async listSellerListings(
    sellerId: string,
    accessToken: string,
  ): Promise<readonly MercadoLibreRemoteListing[]> {
    const itemIds = await this.scanItemIds(sellerId, accessToken);
    const listings: MercadoLibreRemoteListing[] = [];
    for (let index = 0; index < itemIds.length; index += 20) {
      const ids = itemIds.slice(index, index + 20);
      const query = new URLSearchParams({
        ids: ids.join(","),
        attributes: "id,title,status,price,currency_id,available_quantity,sold_quantity,permalink",
      });
      const batch = await this.getJson(`/items?${query}`, accessToken);
      if (!Array.isArray(batch)) throw new Error("MercadoLibre item batch must be an array.");
      for (const rawEntry of batch) {
        const entry = asRecord(rawEntry, "item batch entry");
        if (readNumber(entry, "code") !== 200 || entry.body === undefined) continue;
        const body = asRecord(entry.body, "item body");
        const permalink = readOptionalString(body, "permalink");
        const normalized = {
          itemId: readString(body, "id"),
          title: readString(body, "title"),
          status: readString(body, "status"),
          priceMinor: toMinorUnits(readNumber(body, "price"), readString(body, "currency_id")),
          currencyId: readString(body, "currency_id"),
          availableQuantity: readInteger(body, "available_quantity"),
          soldQuantity: readInteger(body, "sold_quantity"),
          ...(permalink ? { permalink } : {}),
        };
        listings.push(Object.freeze({ ...normalized, sourceHash: hashPayload(normalized) }));
      }
    }
    return Object.freeze(listings);
  }

  async searchSellerClaims(
    sellerId: string,
    accessToken: string,
  ): Promise<readonly MercadoLibreRemoteClaim[]> {
    const claims: MercadoLibreRemoteClaim[] = [];
    const limit = 30;
    for (let page = 0; page < this.config.maximumScanPages; page += 1) {
      const offset = page * limit;
      const query = new URLSearchParams({
        "players.user_id": sellerId,
        "players.role": "respondent",
        limit: String(limit),
        offset: String(offset),
      });
      const payload = asRecord(
        await this.getJson(`/post-purchase/v1/claims/search?${query}`, accessToken),
        "claim search",
      );
      const data = payload.data;
      if (!Array.isArray(data)) throw new Error("MercadoLibre claim search data must be an array.");
      for (const rawClaim of data) claims.push(normalizeClaim(rawClaim));
      const total = readPagingTotal(payload);
      if (data.length < limit || offset + data.length >= total) break;
    }
    return Object.freeze(claims);
  }

  async searchSellerQuestions(
    sellerId: string,
    accessToken: string,
  ): Promise<readonly MercadoLibreRemoteQuestion[]> {
    const questions: MercadoLibreRemoteQuestion[] = [];
    const limit = 50;
    for (let page = 0; page < this.config.maximumScanPages; page += 1) {
      const offset = page * limit;
      const query = new URLSearchParams({
        seller_id: sellerId,
        api_version: "4",
        limit: String(limit),
        offset: String(offset),
        sort_fields: "date_created",
        sort_types: "DESC",
      });
      const payload = asRecord(
        await this.getJson(`/questions/search?${query}`, accessToken),
        "question search",
      );
      const data = payload.questions;
      if (!Array.isArray(data)) {
        throw new Error("MercadoLibre question search questions must be an array.");
      }
      for (const rawQuestion of data) questions.push(normalizeQuestion(rawQuestion));
      const total = readOptionalNonNegativeInteger(payload, "total") ?? offset + data.length;
      if (data.length < limit || offset + data.length >= total) break;
    }
    return Object.freeze(questions);
  }

  private async scanItemIds(sellerId: string, accessToken: string): Promise<string[]> {
    const ids: string[] = [];
    let scrollId: string | undefined;
    for (let page = 0; page < this.config.maximumScanPages; page += 1) {
      const query = new URLSearchParams({ search_type: "scan", limit: "100" });
      if (scrollId) query.set("scroll_id", scrollId);
      const payload = asRecord(
        await this.getJson(
          `/users/${encodeURIComponent(sellerId)}/items/search?${query}`,
          accessToken,
        ),
        "seller item search",
      );
      const results = payload.results;
      if (!Array.isArray(results) || !results.every((value) => typeof value === "string")) {
        throw new Error("MercadoLibre seller item search returned invalid results.");
      }
      ids.push(...results);
      const nextScrollId = readOptionalString(payload, "scroll_id");
      if (results.length === 0 || !nextScrollId) break;
      scrollId = nextScrollId;
    }
    return [...new Set(ids)];
  }

  private async requestToken(body: URLSearchParams): Promise<MercadoLibreTokenSet> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 500);
      throw new MercadoLibreRemoteError(
        `MercadoLibre token request failed (${response.status}): ${text}`,
        response.status === 400 && /invalid_grant|invalid refresh token/i.test(text),
      );
    }
    const token = asRecord(await response.json(), "token response");
    const scope = readOptionalString(token, "scope");
    const userId = readOptionalStringOrNumber(token, "user_id");
    return Object.freeze({
      accessToken: readString(token, "access_token"),
      refreshToken: readString(token, "refresh_token"),
      expiresInSeconds: readPositiveInteger(token, "expires_in"),
      tokenType: readString(token, "token_type"),
      scopes: scope?.split(/\s+/).filter(Boolean) ?? [],
      ...(userId === undefined ? {} : { userId }),
    });
  }

  private async getJson(path: string, accessToken: string): Promise<unknown> {
    const response = await fetch(new URL(path, this.config.apiBaseUrl), {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 500);
      throw new MercadoLibreRemoteError(
        `MercadoLibre read failed (${response.status}) for ${path}: ${text}`,
        response.status === 401,
      );
    }
    return response.json();
  }
}

function normalizeClaim(value: unknown): MercadoLibreRemoteClaim {
  const claim = asRecord(value, "claim");
  const reasonId = readOptionalStringOrNumber(claim, "reason_id");
  const fulfilled = readOptionalBoolean(claim, "fulfilled");
  const normalized = {
    claimId: readStringOrNumber(claim, "id"),
    resourceId: readStringOrNumber(claim, "resource_id"),
    resource: readString(claim, "resource"),
    status: readString(claim, "status"),
    type: readString(claim, "type"),
    stage: readString(claim, "stage"),
    ...(reasonId ? { reasonId } : {}),
    ...(fulfilled === undefined ? {} : { fulfilled }),
    dateCreated: readIsoDate(claim, "date_created"),
    lastUpdated: readIsoDate(claim, "last_updated"),
  };
  return Object.freeze({ ...normalized, sourceHash: hashPayload(normalized) });
}

function normalizeQuestion(value: unknown): MercadoLibreRemoteQuestion {
  const question = asRecord(value, "question");
  const answer = question.answer;
  const normalized = {
    questionId: readStringOrNumber(question, "id"),
    itemId: readString(question, "item_id"),
    status: readString(question, "status"),
    dateCreated: readIsoDate(question, "date_created"),
    hasAnswer: answer !== undefined && answer !== null,
    hold: readOptionalBoolean(question, "hold") ?? false,
    suspectedSpam: readOptionalBoolean(question, "suspected_spam") ?? false,
  };
  return Object.freeze({ ...normalized, sourceHash: hashPayload(normalized) });
}

function readPagingTotal(payload: Record<string, unknown>): number {
  const paging = asRecord(payload.paging, "claim paging");
  return readNonNegativeInteger(paging, "total");
}

function hashPayload(value: object): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`MercadoLibre ${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`MercadoLibre field ${key} must be a non-empty string.`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`MercadoLibre field ${key} must be a string.`);
  return value;
}

function readStringOrNumber(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`MercadoLibre field ${key} must be a string or number.`);
  }
  return String(value);
}

function readOptionalStringOrNumber(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`MercadoLibre field ${key} must be a string or number.`);
  }
  return String(value);
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`MercadoLibre field ${key} must be boolean.`);
  return value;
}

function readIsoDate(record: Record<string, unknown>, key: string): string {
  const value = readString(record, key);
  if (Number.isNaN(Date.parse(value))) throw new Error(`MercadoLibre field ${key} must be a date.`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`MercadoLibre field ${key} must be a finite number.`);
  }
  return value;
}

function readInteger(record: Record<string, unknown>, key: string): number {
  const value = readNumber(record, key);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`MercadoLibre field ${key} must be a non-negative integer.`);
  }
  return value;
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  return readInteger(record, key);
}

function readOptionalNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  return readNonNegativeInteger(record, key);
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = readNumber(record, key);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`MercadoLibre field ${key} must be a positive integer.`);
  }
  return value;
}

function toMinorUnits(amount: number, currencyId: string): number {
  const decimals = currencyId === "CLP" ? 0 : 2;
  return Math.round(amount * 10 ** decimals);
}
