import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "eauto.operator-session.v1";

export type MobileSession = Readonly<{
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  actor: Readonly<{
    id: string;
    organizationId: string;
    roles: readonly string[];
    accountIds: readonly string[];
  }>;
}>;

export const sessionStore = {
  async load(): Promise<MobileSession | null> {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MobileSession;
    } catch {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    }
  },

  async save(session: MobileSession): Promise<void> {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};
