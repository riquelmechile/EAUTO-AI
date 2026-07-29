import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { DashboardScreen } from "./src/features/dashboard/DashboardScreen";
import { InboxScreen } from "./src/features/inbox/InboxScreen";
import { ContentStudioScreen } from "./src/features/content-studio/ContentStudioScreen";
import { LoginScreen } from "./src/features/auth/LoginScreen";
import { AgentOsScreen } from "./src/features/agents/AgentOsScreen";
import { OperationalIntelligenceScreen } from "./src/features/agents/OperationalIntelligenceScreen";
import { MercadoLibreScreen } from "./src/features/mercadolibre/MercadoLibreScreen";
import { ProductIdentificationScreen } from "./src/features/product-identification/ProductIdentificationScreen";
import { api } from "./src/lib/api";
import { sessionStore, type MobileSession } from "./src/lib/session";
import { theme } from "./src/theme";

type Tab =
  "dashboard" | "agents" | "intelligence" | "mercadolibre" | "product" | "inbox" | "studio";

const TABS: readonly { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "Empresa", icon: "⌂" },
  { id: "agents", label: "Agentes", icon: "◎" },
  { id: "intelligence", label: "Intel", icon: "✦" },
  { id: "mercadolibre", label: "MercadoLibre", icon: "M" },
  { id: "product", label: "Producto", icon: "◇" },
  { id: "inbox", label: "Decisiones", icon: "✓" },
  { id: "studio", label: "Contenido", icon: "◐" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    let mounted = true;
    void api
      .session()
      .then((stored) => {
        if (mounted) setSession(stored);
      })
      .finally(() => {
        if (mounted) setLoadingSession(false);
      });
    const unsubscribe = sessionStore.subscribeCleared(() => setSession(null));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function logout(): Promise<void> {
    await api.logout();
    setSession(null);
    setTab("dashboard");
  }

  if (loadingSession) {
    return (
      <SafeAreaView style={styles.centered}>
        <StatusBar style="light" />
        <View style={styles.loaderMark}>
          <Text style={styles.loaderMarkText}>EA</Text>
        </View>
        <ActivityIndicator color={theme.colors.primary} size="large" />
        <Text style={styles.loadingText}>Validando sesión segura…</Text>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <LoginScreen onAuthenticated={setSession} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.brandGroup}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>EA</Text>
          </View>
          <View style={styles.brandCopy}>
            <Text style={styles.brand}>EAUTO-AI</Text>
            <Text style={styles.subtitle}>Control center comercial</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void logout()}
          style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
        >
          <Text style={styles.logoutText}>Salir</Text>
        </Pressable>
      </View>

      <View style={styles.sessionBar}>
        <View style={styles.statusGroup}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Sesión protegida</Text>
        </View>
        <Text numberOfLines={1} style={styles.actor}>
          {session.actor.id}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.tabs}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item.id}
              onPress={() => setTab(item.id)}
              style={({ pressed }) => [
                styles.tab,
                active && styles.activeTab,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.tabIcon, active && styles.activeTabIcon]}>{item.icon}</Text>
              <Text style={[styles.tabText, active && styles.activeTabText]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === "dashboard" ? <DashboardScreen /> : null}
        {tab === "agents" ? <AgentOsScreen roles={session.actor.roles} /> : null}
        {tab === "intelligence" ? (
          <OperationalIntelligenceScreen roles={session.actor.roles} />
        ) : null}
        {tab === "mercadolibre" ? <MercadoLibreScreen roles={session.actor.roles} /> : null}
        {tab === "product" ? <ProductIdentificationScreen roles={session.actor.roles} /> : null}
        {tab === "inbox" ? <InboxScreen /> : null}
        {tab === "studio" ? <ContentStudioScreen /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  centered: {
    alignItems: "center",
    backgroundColor: theme.colors.background,
    flex: 1,
    gap: theme.spacing.lg,
    justifyContent: "center",
  },
  loaderMark: {
    alignItems: "center",
    backgroundColor: theme.colors.primaryMuted,
    borderColor: theme.colors.primary,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  loaderMarkText: {
    color: theme.colors.white,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 1,
  },
  loadingText: {
    color: theme.colors.textSoft,
    fontWeight: "600",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
  },
  brandGroup: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: theme.spacing.md,
  },
  logo: {
    alignItems: "center",
    backgroundColor: theme.colors.primaryStrong,
    borderColor: theme.colors.primary,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  logoText: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  brandCopy: {
    flexShrink: 1,
  },
  brand: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  subtitle: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  logout: {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 10,
  },
  logoutText: {
    color: theme.colors.textSoft,
    fontWeight: "800",
  },
  sessionBar: {
    alignItems: "center",
    backgroundColor: theme.colors.backgroundRaised,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: theme.spacing.xl,
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
  },
  statusGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  statusDot: {
    backgroundColor: theme.colors.success,
    borderRadius: theme.radius.pill,
    height: 8,
    width: 8,
  },
  statusText: {
    color: theme.colors.textSoft,
    fontSize: 12,
    fontWeight: "700",
  },
  actor: {
    color: theme.colors.textMuted,
    flexShrink: 1,
    fontSize: 12,
    marginLeft: theme.spacing.md,
    textAlign: "right",
  },
  tabs: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
  },
  tab: {
    alignItems: "center",
    backgroundColor: theme.colors.surfaceMuted,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minWidth: 106,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 11,
  },
  activeTab: {
    backgroundColor: theme.colors.primaryMuted,
    borderColor: theme.colors.primary,
  },
  tabIcon: {
    color: theme.colors.textMuted,
    fontSize: 15,
    fontWeight: "900",
  },
  activeTabIcon: {
    color: theme.colors.primary,
  },
  tabText: {
    color: theme.colors.textSoft,
    fontSize: 12,
    fontWeight: "700",
  },
  activeTabText: {
    color: theme.colors.white,
  },
  pressed: {
    opacity: 0.72,
  },
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: 48,
  },
});
