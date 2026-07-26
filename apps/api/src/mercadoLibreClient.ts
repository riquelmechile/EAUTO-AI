import { z } from "zod";
import {
  MercadoLibreIntegrationError,
  type MercadoLibreUserProfile,
} from "@eauto/domain";
import type {
  MercadoLibreApiPort,
  MercadoLibreTokenResponse,
} from "@eauto/application";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  user_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  scope: z.string().optional(),
});

const userSchema = z.object({
  id: z.number().int().positive(),
  nickname: z.string().min(1),
  site_id: z.string().min(2),
  country_id: z.string().nullable().optional(),
});

const itemsSearchSchema = z.object({
  results: z.array(z.string().min(1)),
  scroll_id: z.string().min(1).optional(),
});

export class MercadoLibreHttpClient implements MercadoLibreApiPort {
  constructor(
    private readonly config: Readonly<{
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      authorizationBaseUrl: string;
      apiBaseUrl: string;
      timeoutMs: number;
      maximumScanPages: number;
    }>,
  ) {}

  buildAuthorizationUrl(input: { state: string; codeChallenge: string }): string {
    const url = new URL("/authorization", this.config.authorizationBaseUrl);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<MercadoLibreTokenResponse> {
    return this.requestToken({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: input.code,
      redirect_uri: this.config.redirectUri,
      code_verifier: input.codeVerifier,
    });
  }

  refreshAccessToken(refreshToken: string): Promise<MercadoLibreTokenResponse> {
    return this.requestToken({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
    });
  }

  async getCurrentUser(accessToken: string): Promise<MercadoLibreUserProfile> {
    const body = await this.requestJson("/users/me", accessToken);
    const parsed = userSchema.safeParse(body);
    if (!parsed.success) {
      throw new MercadoLibreIntegrationError("Mercado Libre returned an invalid /users/me payload.");
    }
    return Object.freeze({
      id: parsed.data.id,
      nickname: parsed.data.nickname,
      siteId: parsed.data.site_id,
      countryId: parsed.data.country_id ?? null,
    });
  }

  async listSellerItemIds(input: {
    accessToken: string;
    userId: number;
  }): Promise<readonly string[]> {
    const ids: string[] = [];
    let scrollId: string | undefined;

    for (let page = 0; page < this.config.maximumScanPages; page += 1) {
      const search = new URL(`/users/${input.userId}/items/search`, this.config.apiBaseUrl);
      search.searchParams.set("search_type", "scan");
      search.searchParams.set("limit", "100");
      if (scrollId) search.searchParams.set("scroll_id", scrollId);

      const body = await this.requestJson(search.pathname + search.search, input.accessToken);
      const parsed = itemsSearchSchema.safeParse(body);
      if (!parsed.success) {
        throw new MercadoLibreIntegrationError(
          "Mercado Libre returned an invalid seller items payload.",
        );
      }
      ids.push(...parsed.data.results);
      if (parsed.data.results.length === 0 || !parsed.data.scroll_id) break;
      scrollId = parsed.data.scroll_id;
    }

    return Object.freeze(ids);
  }

  private async requestToken(fields: Record<string, string>): Promise<MercadoLibreTokenResponse> {
    const response = await fetch(new URL("/oauth/token", this.config.apiBaseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const body = await safeJson(response);
    if (!response.ok) {
      throw new MercadoLibreIntegrationError(
        `Mercado Libre token request failed with status ${response.status}.`,
      );
    }
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) {
      throw new MercadoLibreIntegrationError("Mercado Libre returned an invalid token payload.");
    }
    return Object.freeze({
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresInSeconds: parsed.data.expires_in,
      userId: Number(parsed.data.user_id),
      scope: parsed.data.scope ?? null,
    });
  }

  private async requestJson(path: string, accessToken: string): Promise<unknown> {
    const response = await fetch(new URL(path, this.config.apiBaseUrl), {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const body = await safeJson(response);
    if (!response.ok) {
      throw new MercadoLibreIntegrationError(
        `Mercado Libre read request failed with status ${response.status}.`,
      );
    }
    return body;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MercadoLibreIntegrationError(
      `Mercado Libre returned a non-JSON response with status ${response.status}.`,
    );
  }
}
