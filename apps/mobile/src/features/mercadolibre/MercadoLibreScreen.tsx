import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Panel } from "../../components/Panel";
import {
  api,
  type MercadoLibreListing,
  type MercadoLibreStatus,
} from "../../lib/api";

const MOBILE_RETURN_URI = "eautoai://mercadolibre/oauth-complete";
const ACCOUNTS = [
  { id: "plasticov", name: "Plasticov" },
  { id: "maustian", name: "Maustian" },
] as const;

type Props = Readonly<{ roles: readonly string[] }>;

export function MercadoLibreScreen({ roles }: Props) {
  const canManage = roles.some((role) => role === "owner" || role === "admin");
  const canSync = roles.some(
    (role) => role === "owner" || role === "admin" || role === "operator",
  );

  return (
    <View style={styles.stack}>
      <Panel title="MercadoLibre Chile">
        <Text style={styles.intro}>
          Conexiones MLC aisladas por cuenta. Esta versión solo lee datos; no publica ni modifica
          precios, stock o anuncios.
        </Text>
        <View style={styles.readOnlyBadge}>
          <Text style={styles.readOnlyText}>SOLO LECTURA</Text>
        </View>
      </Panel>
      {ACCOUNTS.map((account) => (
        <AccountCard
          accountId={account.id}
          canManage={canManage}
          canSync={canSync}
          key={account.id}
          name={account.name}
        />
      ))}
    </View>
  );
}

function AccountCard({
  accountId,
  name,
  canManage,
  canSync,
}: Readonly<{
  accountId: string;
  name: string;
  canManage: boolean;
  canSync: boolean;
}>) {
  const [status, setStatus] = useState<MercadoLibreStatus | null>(null);
  const [listings, setListings] = useState<readonly MercadoLibreListing[]>([]);
  const [busy, setBusy] = useState<"connect" | "sync" | "load" | null>("load");
  const [message, setMessage] = useState("Consultando conexión…");

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const current = await api.mercadoLibreStatus(accountId);
      setStatus(current);
      if (current.connected) {
        const result = await api.mercadoLibreListings(accountId);
        setListings(result.listings);
        setMessage(
          current.connection?.lastSyncedAt
            ? `Última sincronización: ${formatDate(current.connection.lastSyncedAt)}`
            : "Cuenta conectada; aún no se ha sincronizado.",
        );
      } else {
        setListings([]);
        setMessage("Cuenta todavía no conectada.");
      }
    } catch (error) {
      setMessage(readError(error));
    } finally {
      setBusy(null);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(): Promise<void> {
    setBusy("connect");
    setMessage("Abriendo autorización segura de MercadoLibre Chile…");
    try {
      const authorization = await api.mercadoLibreAuthorize(accountId);
      const result = await WebBrowser.openAuthSessionAsync(
        authorization.authorizationUrl,
        MOBILE_RETURN_URI,
      );
      if (result.type !== "success") {
        setMessage("Autorización cancelada; no se guardó ningún cambio.");
        return;
      }
      const returned = new URL(result.url);
      if (
        returned.protocol !== "eautoai:" ||
        returned.hostname !== "mercadolibre" ||
        returned.pathname !== "/oauth-complete" ||
        returned.searchParams.get("result") !== "connected" ||
        returned.searchParams.get("accountId") !== accountId ||
        returned.searchParams.get("siteId") !== "MLC"
      ) {
        throw new Error("MercadoLibre devolvió un resultado inesperado.");
      }
      setMessage("Cuenta autorizada. Verificando estado en el servidor…");
      await load();
    } catch (error) {
      setMessage(readError(error));
    } finally {
      setBusy(null);
    }
  }

  async function sync(): Promise<void> {
    setBusy("sync");
    setMessage("Sincronizando publicaciones privadas…");
    try {
      const result = await api.mercadoLibreSync(accountId);
      if (result.writesPerformed !== false) {
        throw new Error("El servidor informó una operación de escritura inesperada.");
      }
      const currentListings = await api.mercadoLibreListings(accountId);
      setListings(currentListings.listings);
      setStatus({ enabled: true, connected: true, connection: result.connection });
      setMessage(
        `Sincronización verificada: ${result.listingCount} publicaciones, sin escrituras.`,
      );
    } catch (error) {
      setMessage(readError(error));
    } finally {
      setBusy(null);
    }
  }

  const connection = status?.connection ?? null;
  const requiresAuthorization = connection?.status === "reauthorization-required";

  return (
    <Panel title={name}>
      <View style={styles.connectionRow}>
        <View>
          <Text style={styles.connectionStatus}>
            {status?.connected ? statusLabel(connection?.status) : "Sin conectar"}
          </Text>
          {connection ? (
            <Text style={styles.meta}>
              Seller {connection.sellerId} · {connection.siteId}
              {connection.nickname ? ` · ${connection.nickname}` : ""}
            </Text>
          ) : null}
        </View>
        <View style={[styles.dot, status?.connected ? styles.dotOnline : styles.dotOffline]} />
      </View>

      <Text style={styles.message}>{message}</Text>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={!canManage || busy !== null}
          onPress={() => void connect()}
          style={[styles.button, (!canManage || busy !== null) && styles.disabled]}
        >
          <Text style={styles.buttonText}>
            {requiresAuthorization ? "Reautorizar" : status?.connected ? "Reconectar" : "Conectar"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!canSync || !status?.connected || requiresAuthorization || busy !== null}
          onPress={() => void sync()}
          style={[
            styles.secondaryButton,
            (!canSync || !status?.connected || requiresAuthorization || busy !== null) &&
              styles.disabled,
          ]}
        >
          <Text style={styles.buttonText}>{busy === "sync" ? "Sincronizando…" : "Sincronizar"}</Text>
        </Pressable>
      </View>

      {!canManage ? (
        <Text style={styles.permission}>Su rol puede consultar, pero no conectar cuentas.</Text>
      ) : null}

      {listings.length > 0 ? (
        <View style={styles.listings}>
          <Text style={styles.sectionTitle}>Publicaciones ({listings.length})</Text>
          {listings.slice(0, 20).map((listing) => (
            <Pressable
              accessibilityRole={listing.permalink ? "link" : undefined}
              disabled={!listing.permalink}
              key={listing.itemId}
              onPress={() => {
                if (listing.permalink) void Linking.openURL(listing.permalink);
              }}
              style={styles.listing}
            >
              <View style={styles.listingHeader}>
                <Text numberOfLines={2} style={styles.listingTitle}>
                  {listing.title}
                </Text>
                <Text style={styles.price}>{formatMoney(listing.priceMinor, listing.currencyId)}</Text>
              </View>
              <Text style={styles.meta}>
                {listing.itemId} · {listing.status} · stock {listing.availableQuantity} · vendidas {" "}
                {listing.soldQuantity}
              </Text>
            </Pressable>
          ))}
          {listings.length > 20 ? (
            <Text style={styles.permission}>
              Se muestran 20 publicaciones; el snapshot conserva {listings.length}.
            </Text>
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
}

function statusLabel(status: MercadoLibreStatus["connection"] extends infer _T ? string | undefined : never) {
  switch (status) {
    case "active":
      return "Conectada";
    case "refreshing":
      return "Renovando credenciales";
    case "reauthorization-required":
      return "Requiere reautorización";
    case "revoked":
      return "Revocada";
    default:
      return "Conectada";
  }
}

function formatMoney(amountMinor: number, currency: string): string {
  const divisor = currency === "CLP" ? 1 : 100;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "CLP" ? 0 : 2,
  }).format(amountMinor / divisor);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  intro: { color: "#cbd5e1", lineHeight: 21 },
  readOnlyBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#164e63",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  readOnlyText: { color: "#a5f3fc", fontSize: 11, fontWeight: "900" },
  connectionRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  connectionStatus: { color: "#f8fafc", fontSize: 18, fontWeight: "800" },
  meta: { color: "#94a3b8", fontSize: 12, lineHeight: 18 },
  dot: { borderRadius: 999, height: 12, width: 12 },
  dotOnline: { backgroundColor: "#22c55e" },
  dotOffline: { backgroundColor: "#64748b" },
  message: { color: "#bae6fd", lineHeight: 20 },
  actions: { flexDirection: "row", gap: 10 },
  button: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 12,
    flex: 1,
    padding: 12,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#334155",
    borderRadius: 12,
    flex: 1,
    padding: 12,
  },
  disabled: { opacity: 0.4 },
  buttonText: { color: "white", fontWeight: "800" },
  permission: { color: "#94a3b8", fontSize: 12 },
  listings: { borderTopColor: "#334155", borderTopWidth: 1, gap: 8, paddingTop: 12 },
  sectionTitle: { color: "#f8fafc", fontSize: 15, fontWeight: "800" },
  listing: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 11,
  },
  listingHeader: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  listingTitle: { color: "#e2e8f0", flex: 1, fontWeight: "700" },
  price: { color: "#7dd3fc", fontWeight: "900" },
});
