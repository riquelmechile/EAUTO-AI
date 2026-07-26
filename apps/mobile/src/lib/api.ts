import { sessionStore, type MobileSession } from "./session";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:3000";
let refreshInFlight: Promise<MobileSession> | null = null;

export type Dashboard = {
  company: string;
  pendingDecisions: number;
  status: string;
  actor: { id: string; roles: readonly string[] };
  accounts: readonly { id: string; name: string; autonomyLevel: string }[];
};

export type PendingAction = {
  id: string;
  accountId: string;
  kind: string;
  rationale: string;
  risk: string;
  status: string;
};

export type RequestedSourceImageUpload = Readonly<{
  upload: Readonly<{
    id: string;
    accountId: string;
    status: "requested";
    expiresAt: string;
  }>;
  uploadUrl: string;
  requiredHeaders: Readonly<Record<string, string>>;
}>;

export type MercadoLibreConnection = Readonly<{
  accountId: string;
  sellerId: string;
  nickname?: string;
  siteId: "MLC";
  status: "active" | "refreshing" | "reauthorization-required" | "revoked";
  expiresAt: string;
  lastSyncedAt?: string;
}>;

export type MercadoLibreStatus = Readonly<{
  enabled: boolean;
  connected: boolean;
  connection: MercadoLibreConnection | null;
}>;

export type MercadoLibreListing = Readonly<{
  itemId: string;
  title: string;
  status: string;
  priceMinor: number;
  currencyId: string;
  availableQuantity: number;
  soldQuantity: number;
  permalink?: string;
  observedAt: string;
}>;

export type MercadoLibreClaim = Readonly<{
  claimId: string;
  resourceId: string;
  resource: string;
  status: string;
  type: string;
  stage: string;
  reasonId?: string;
  fulfilled?: boolean;
  dateCreated: string;
  lastUpdated: string;
  observedAt: string;
}>;

export type MercadoLibreQuestion = Readonly<{
  questionId: string;
  itemId: string;
  status: string;
  dateCreated: string;
  hasAnswer: boolean;
  hold: boolean;
  suspectedSpam: boolean;
  observedAt: string;
}>;

export type MercadoLibreOrder = Readonly<{
  orderId: string;
  status: string;
  dateCreated: string;
  dateClosed?: string;
  lastUpdated: string;
  currencyId: string;
  totalAmountMinor: number;
  paidAmountMinor?: number;
  itemCount: number;
  unitCount: number;
  itemIds: readonly string[];
  packId?: string;
  shippingId?: string;
  tags: readonly string[];
  observedAt: string;
}>;

export type MercadoLibreReputation = Readonly<{
  sellerId: string;
  siteId: "MLC";
  levelId?: string;
  powerSellerStatus?: string;
  period: string;
  totalTransactions: number;
  completedTransactions: number;
  canceledTransactions: number;
  positiveRating: number;
  neutralRating: number;
  negativeRating: number;
  observedAt: string;
}>;

type RequestOptions = RequestInit & { retryAuthentication?: boolean };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { retryAuthentication = true, ...requestInit } = options;
  const session = await sessionStore.load();
  const response = await fetch(`${API_URL}${path}`, {
    ...requestInit,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      ...requestInit.headers,
    },
  });

  if (response.status === 401 && retryAuthentication && session) {
    await refreshSession(session.refreshToken);
    return request<T>(path, { ...requestInit, retryAuthentication: false });
  }
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function refreshSession(refreshToken: string): Promise<MobileSession> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const response = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    if (!response.ok) {
      await sessionStore.clear();
      throw new Error(`Session refresh failed: ${response.status}`);
    }
    const session = (await response.json()) as MobileSession;
    await sessionStore.save(session);
    return session;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export const api = {
  session: () => sessionStore.load(),

  enroll: async (enrollmentToken: string): Promise<MobileSession> => {
    const response = await fetch(`${API_URL}/v1/auth/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${enrollmentToken.trim()}` },
    });
    if (!response.ok) throw new Error(`Enrollment failed: ${response.status}`);
    const session = (await response.json()) as MobileSession;
    await sessionStore.save(session);
    return session;
  },

  logout: async (): Promise<void> => {
    const session = await sessionStore.load();
    try {
      if (session) {
        await fetch(`${API_URL}/v1/auth/logout`, {
          method: "POST",
          headers: { authorization: `Bearer ${session.accessToken}` },
        });
      }
    } finally {
      await sessionStore.clear();
    }
  },

  dashboard: () => request<Dashboard>("/v1/dashboard"),
  inbox: () => request<{ actions: PendingAction[] }>("/v1/inbox"),

  mercadoLibreStatus: (accountId: string) =>
    request<MercadoLibreStatus>(
      `/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/status`,
    ),

  mercadoLibreAuthorize: (accountId: string) =>
    request<{ authorizationUrl: string; expiresAt: string }>(
      `/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/authorize`,
      { method: "POST" },
    ),

  mercadoLibreSync: (accountId: string) =>
    request<{
      connection: MercadoLibreConnection;
      listingCount: number;
      observedAt?: string;
      writesPerformed: false;
    }>(`/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/sync`, {
      method: "POST",
    }),

  mercadoLibreListings: (accountId: string) =>
    request<{ listings: readonly MercadoLibreListing[] }>(
      `/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/listings`,
    ),

  mercadoLibreCustomerOperationsSync: (accountId: string) =>
    request<{
      claimCount: number;
      openClaimCount: number;
      questionCount: number;
      unansweredQuestionCount: number;
      observedAt: string;
      writesPerformed: false;
    }>(`/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/customer-operations/sync`, {
      method: "POST",
    }),

  mercadoLibreClaims: (accountId: string) =>
    request<{ claims: readonly MercadoLibreClaim[] }>(
      `/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/claims`,
    ),

  mercadoLibreQuestions: (accountId: string) =>
    request<{ questions: readonly MercadoLibreQuestion[] }>(
      `/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/questions`,
    ),

  mercadoLibreCommercialOperationsSync: (accountId: string) =>
    request<{
      orderCount: number;
      paidOrderCount: number;
      canceledOrderCount: number;
      grossTotalMinor: number;
      currencyId: "CLP";
      reputation: MercadoLibreReputation;
      observedAt: string;
      writesPerformed: false;
    }>(
      `/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/commercial-operations/sync`,
      { method: "POST" },
    ),

  mercadoLibreOrders: (accountId: string) =>
    request<{ orders: readonly MercadoLibreOrder[] }>(
      `/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/orders`,
    ),

  mercadoLibreReputation: (accountId: string) =>
    request<{ reputation: MercadoLibreReputation | null }>(
      `/v1/integrations/mercadolibre/${encodeURIComponent(accountId)}/reputation`,
    ),

  requestSourceImageUpload: (input: {
    id: string;
    accountId: string;
    originalFileName: string;
    contentType: "image/jpeg" | "image/png" | "image/webp";
    sizeBytes: number;
    checksumSha256Base64: string;
  }) =>
    request<RequestedSourceImageUpload>("/v1/uploads/source-images", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  completeSourceImageUpload: (input: { id: string; accountId: string }) =>
    request<Readonly<{ id: string; status: "verified"; objectUri: string }>>(
      `/v1/uploads/source-images/${encodeURIComponent(input.id)}/complete`,
      { method: "POST", body: JSON.stringify({ accountId: input.accountId }) },
    ),

  createLaunch: (input: {
    id: string;
    accountId: string;
    sourceImageUploadId: string;
    instructions?: string;
  }) =>
    request<{ assets: readonly { id: string; kind: string; uri: string }[] }>(
      "/v1/content/launches",
      {
        method: "POST",
        body: JSON.stringify({ ...input, requestedChannels: ["mercadolibre", "instagram"] }),
      },
    ),
};
