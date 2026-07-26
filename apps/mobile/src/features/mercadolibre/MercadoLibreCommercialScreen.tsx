import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Panel } from "../../components/Panel";
import { api, type MercadoLibreStatus } from "../../lib/api";
import { MercadoLibreCommercialPanel } from "./MercadoLibreCommercialPanel";

const ACCOUNTS = [
  { id: "plasticov", name: "Plasticov" },
  { id: "maustian", name: "Maustian" },
] as const;

export function MercadoLibreCommercialScreen({ roles }: Readonly<{ roles: readonly string[] }>) {
  const canSync = roles.some(
    (role) => role === "owner" || role === "admin" || role === "operator",
  );
  return (
    <View style={styles.stack}>
      <Panel title="Ventas y reputación MLC">
        <Text style={styles.intro}>
          Órdenes y reputación agregada por seller. Se excluyen comprador, contacto, facturación y
          dirección; no se ejecutan mutaciones.
        </Text>
      </Panel>
      {ACCOUNTS.map((account) => (
        <CommercialAccount
          accountId={account.id}
          canSync={canSync}
          key={account.id}
          name={account.name}
        />
      ))}
    </View>
  );
}

function CommercialAccount({
  accountId,
  name,
  canSync,
}: Readonly<{ accountId: string; name: string; canSync: boolean }>) {
  const [status, setStatus] = useState<MercadoLibreStatus | null>(null);
  const [message, setMessage] = useState("Consultando conexión…");

  const load = useCallback(async () => {
    try {
      const current = await api.mercadoLibreStatus(accountId);
      setStatus(current);
      setMessage(current.connected ? "Cuenta conectada en modo solo lectura." : "Cuenta sin conectar.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible consultar la cuenta.");
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title={name}>
      <Text style={styles.status}>{message}</Text>
      <MercadoLibreCommercialPanel
        accountId={accountId}
        canSync={canSync}
        connected={status?.connected ?? false}
      />
    </Panel>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  intro: { color: "#cbd5e1", lineHeight: 21 },
  status: { color: "#bae6fd", fontSize: 12 },
});
