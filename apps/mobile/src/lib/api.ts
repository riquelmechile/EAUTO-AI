const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:3000";
const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN;

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(API_TOKEN ? { authorization: `Bearer ${API_TOKEN}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

export const api = {
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
