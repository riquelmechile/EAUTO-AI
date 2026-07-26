import { createHash } from "node:crypto";
import { z } from "zod";
import {
  MercadoLibreRemoteError,
  type MercadoLibreClientPort,
  type MercadoLibreRemoteListing,
  type MercadoLibreRemoteUser,
  type MercadoLibreTokenSet,
} from "@eauto/application";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().min(1),
  scope: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
});

const userSchema = z.object({
  id: z.union([z.string(), z.number()]),
  nickname: z.string().optional(),
  site_id: z.string().min(1),
});

const searchSchema = z.object({
  results: z.array(z.string()),
  scroll_id: z.string().optional(),
});

const itemBodySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  price: z.number().nonnegative(),
  currency_id: z.string(),
  available_quantity: z.number().int().nonnegative(),
  sold_quantity: z.number().int().nonnegative(),
  permalink: z.string().url().optional(),
});

const itemBatchSchema = z.array(
  z.object({
    code: z.number().int(),
    body: itemBodySchema.optional(),
  }),
);

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

  async exchangeAuthorizationCode(input: {
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

  async refreshAccessToken(refreshToken: string): Promise<MercadoLibreTokenSet> {
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
    const payload = userSchema.parse(await this.getJson("/users/me", accessToken));
    return Object.freeze({
      id: String(payload.id),
      ...(payload.nickname ? { nickname: payload.nickname } : {}),
      siteId: payload.site_id,
    });
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
        attributes:
          "id,title,status,price,currency_id,available_quantity,sold_quantity,permalink",
      });
      const batch = itemBatchSchema.parse(await this.getJson(`/items?${query}`, accessToken));
      for (const entry of batch) {
        if (entry.code !== 200 || !entry.body) continue;
        const body = entry.body;
        const normalized = {
          itemId: body.id,
          title: body.title,
          status: body.status,
          priceMinor: toMinorUnits(body.price, body.currency_id),
          currencyId: body.currency_id,
          availableQuantity: body.available_quantity,
          soldQuantity: body.sold_quantity,
          ...(body.permalink ? { permalink: body.permalink } : {}),
        };
        listings.push(
          Object.freeze({
            ...normalized,
            sourceHash: createHash("sha256")
              .update(JSON.stringify(normalized), "utf8")
              .digest("hex"),
          }),
        );
      }
    }
    return Object.freeze(listings);
  }

  private async scanItemIds(sellerId: string, accessToken: string): Promise<string[]> {
    const ids: string[] = [];
    let scrollId: string | undefined;
    for (let page = 0; page < this.config.maximumScanPages; page += 1) {
      const query = new URLSearchParams({ search_type: "scan", limit: "100" });
      if (scrollId) query.set("scroll_id", scrollId);
      const payload = searchSchema.parse(
        await this.getJson(`/users/${encodeURIComponent(sellerId)}/items/search?${query}`, accessToken),
      );
      ids.push(...payload.results);
      if (payload.results.length === 0 || !payload.scroll_id) break;
      scrollId = payload.scroll_id;
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
      const reauthorizationRequired =
        response.status === 400 && /invalid_grant|invalid refresh token/i.test(text);
      throw new MercadoLibreRemoteError(
        `MercadoLibre token request failed (${response.status}): ${text}`,
        reauthorizationRequired,
      );
    }
    const token = tokenSchema.parse(await response.json());
    return Object.freeze({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresInSeconds: token.expires_in,
      tokenType: token.token_type,
      scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
      ...(token.user_id === undefined ? {} : { userId: String(token.user_id) }),
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

function toMinorUnits(amount: number, currencyId: string): number {
  const decimals = currencyId === "CLP" ? 0 : 2;
  return Math.round(amount * 10 ** decimals);
}
