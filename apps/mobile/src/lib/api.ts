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

type RequestOptions = RequestInit & { retryAuthentication?: boolean };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const session = await sessionStore.load();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401 && options.retryAuthentication !== false && session) {
    const rotated = await refreshSession(session.refreshToken);
    return request<T>(path, { ...options, retryAuthentication: false, headers: options.headers });
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
  createLaunch: (input: {
    id: string;
    accountId: string;
    sourceImageUri: string;
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
