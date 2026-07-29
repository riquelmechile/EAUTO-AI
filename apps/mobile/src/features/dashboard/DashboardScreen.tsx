import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Panel } from "../../components/Panel";
import { api, type Dashboard } from "../../lib/api";
import { theme } from "../../theme";

export function DashboardScreen() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      setData(await api.dashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el panel.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data && !error) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
        <Text style={styles.loadingText}>Leyendo el pulso de la empresa…</Text>
      </View>
    );
  }

  const accountCount = data?.accounts.length ?? 0;
  const pendingDecisions = data?.pendingDecisions ?? 0;
  const companyStatus = data?.status ?? "sin conexión";

  return (
    <View style={styles.stack}>
      <Panel title="Pulso de la empresa">
        <View style={styles.heroRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>OPERACIÓN EN TIEMPO REAL</Text>
            <Text style={styles.metric}>{data?.company ?? "EAUTO-AI"}</Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  companyStatus === "operational" || companyStatus === "ok"
                    ? styles.statusHealthy
                    : styles.statusWarning,
                ]}
              />
              <Text style={styles.statusLabel}>{companyStatus}</Text>
            </View>
          </View>
          <View style={styles.pulseMark}>
            <Text style={styles.pulseMarkText}>24/7</Text>
          </View>
        </View>

        <View style={styles.metricsGrid}>
          <MetricCard
            label="Decisiones pendientes"
            tone={pendingDecisions > 0 ? "warning" : "success"}
            value={String(pendingDecisions)}
          />
          <MetricCard label="Cuentas activas" tone="primary" value={String(accountCount)} />
        </View>
      </Panel>

      <Panel title="Cuentas comerciales">
        <View style={styles.accountsList}>
          {data?.accounts.map((account) => (
            <View key={account.id} style={styles.accountCard}>
              <View style={styles.accountIdentity}>
                <View style={styles.accountAvatar}>
                  <Text style={styles.accountAvatarText}>
                    {account.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={styles.account}>{account.name}</Text>
                  <Text style={styles.accountId}>{account.id}</Text>
                </View>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{account.autonomyLevel.toUpperCase()}</Text>
              </View>
            </View>
          ))}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>No fue posible actualizar</Text>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={refreshing}
          onPress={() => void load()}
          style={({ pressed }) => [
            styles.button,
            refreshing && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {refreshing ? (
            <ActivityIndicator color={theme.colors.white} />
          ) : (
            <Text style={styles.buttonText}>Actualizar empresa</Text>
          )}
        </Pressable>
      </Panel>
    </View>
  );
}

function MetricCard(props: {
  label: string;
  value: string;
  tone: "primary" | "success" | "warning";
}) {
  const toneStyle =
    props.tone === "success"
      ? styles.metricSuccess
      : props.tone === "warning"
        ? styles.metricWarning
        : styles.metricPrimary;
  return (
    <View style={[styles.metricCard, toneStyle]}>
      <Text style={styles.metricValue}>{props.value}</Text>
      <Text style={styles.metricLabel}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: theme.spacing.lg,
  },
  loading: {
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: 48,
  },
  loadingText: {
    color: theme.colors.textMuted,
    fontWeight: "600",
  },
  heroRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroCopy: {
    flexShrink: 1,
  },
  eyebrow: {
    color: theme.colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  metric: {
    color: theme.colors.text,
    fontSize: 31,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: theme.spacing.xs,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  statusDot: {
    borderRadius: theme.radius.pill,
    height: 8,
    width: 8,
  },
  statusHealthy: {
    backgroundColor: theme.colors.success,
  },
  statusWarning: {
    backgroundColor: theme.colors.warning,
  },
  statusLabel: {
    color: theme.colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  pulseMark: {
    alignItems: "center",
    backgroundColor: theme.colors.primaryMuted,
    borderColor: theme.colors.primary,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    height: 70,
    justifyContent: "center",
    width: 70,
  },
  pulseMarkText: {
    color: theme.colors.primary,
    fontSize: 17,
    fontWeight: "900",
  },
  metricsGrid: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  metricCard: {
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    flex: 1,
    minHeight: 96,
    padding: theme.spacing.md,
  },
  metricPrimary: {
    backgroundColor: theme.colors.primaryMuted,
    borderColor: theme.colors.primary,
  },
  metricSuccess: {
    backgroundColor: theme.colors.successMuted,
    borderColor: theme.colors.success,
  },
  metricWarning: {
    backgroundColor: theme.colors.warningMuted,
    borderColor: theme.colors.warning,
  },
  metricValue: {
    color: theme.colors.white,
    fontSize: 26,
    fontWeight: "900",
  },
  metricLabel: {
    color: theme.colors.textSoft,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: theme.spacing.xs,
  },
  accountsList: {
    gap: theme.spacing.sm,
  },
  accountCard: {
    alignItems: "center",
    backgroundColor: theme.colors.surfaceMuted,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: theme.spacing.md,
  },
  accountIdentity: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: theme.spacing.md,
  },
  accountAvatar: {
    alignItems: "center",
    backgroundColor: theme.colors.primaryStrong,
    borderRadius: theme.radius.medium,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  accountAvatarText: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: "900",
  },
  account: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  accountId: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  badge: {
    backgroundColor: theme.colors.warningMuted,
    borderColor: theme.colors.warning,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    marginLeft: theme.spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    color: theme.colors.warning,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  errorBox: {
    backgroundColor: theme.colors.dangerMuted,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
  },
  errorTitle: {
    color: theme.colors.danger,
    fontWeight: "900",
  },
  error: {
    color: theme.colors.textSoft,
    lineHeight: 19,
  },
  button: {
    alignItems: "center",
    backgroundColor: theme.colors.primaryStrong,
    borderColor: theme.colors.primary,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonText: {
    color: theme.colors.white,
    fontWeight: "900",
  },
});
