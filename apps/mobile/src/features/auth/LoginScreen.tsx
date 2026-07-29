import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import type { MobileSession } from "../../lib/session";
import { theme } from "../../theme";

export function LoginScreen(props: { onAuthenticated(session: MobileSession): void }) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enroll(): Promise<void> {
    const normalized = token.trim();
    if (normalized.length < 16) {
      setError("Ingrese el código de enrolamiento entregado por el administrador.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.enroll(normalized);
      setToken("");
      props.onAuthenticated(session);
    } catch {
      setError("No fue posible validar el código. Revise la conexión y vuelva a intentarlo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.page}>
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>EA</Text>
      </View>
      <View style={styles.heading}>
        <View style={styles.secureBadge}>
          <View style={styles.secureDot} />
          <Text style={styles.secureBadgeText}>CONTROL SEGURO</Text>
        </View>
        <Text style={styles.brand}>EAUTO-AI</Text>
        <Text style={styles.title}>Tu empresa agéntica, bajo control.</Text>
        <Text style={styles.description}>
          Enrola este dispositivo una sola vez. Solo se guarda una sesión revocable dentro del
          almacenamiento cifrado del teléfono.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.fieldLabel}>CÓDIGO DE ENROLAMIENTO</Text>
        <TextInput
          accessibilityLabel="Código de enrolamiento"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setToken}
          placeholder="Pegue el código seguro"
          placeholderTextColor={theme.colors.textMuted}
          secureTextEntry
          style={styles.input}
          value={token}
        />
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => void enroll()}
          style={({ pressed }) => [
            styles.button,
            submitting && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={theme.colors.white} />
          ) : (
            <Text style={styles.buttonText}>Ingresar al control center</Text>
          )}
        </Pressable>
        <Text style={styles.helper}>El código no se almacena después del enrolamiento.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  brandMark: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: theme.colors.primaryStrong,
    borderColor: theme.colors.primary,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    height: 62,
    justifyContent: "center",
    marginBottom: theme.spacing.xl,
    width: 62,
  },
  brandMarkText: {
    color: theme.colors.white,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 1,
  },
  heading: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  secureBadge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: theme.colors.successMuted,
    borderColor: theme.colors.success,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  secureDot: {
    backgroundColor: theme.colors.success,
    borderRadius: theme.radius.pill,
    height: 7,
    width: 7,
  },
  secureBadgeText: {
    color: theme.colors.success,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  brand: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginTop: theme.spacing.sm,
  },
  title: {
    color: theme.colors.text,
    fontSize: 31,
    fontWeight: "900",
    letterSpacing: -0.8,
    lineHeight: 37,
  },
  description: {
    color: theme.colors.textSoft,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    elevation: 5,
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
  },
  fieldLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  input: {
    backgroundColor: theme.colors.backgroundRaised,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    color: theme.colors.white,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: theme.spacing.lg,
  },
  errorBox: {
    backgroundColor: theme.colors.dangerMuted,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    padding: theme.spacing.md,
  },
  error: {
    color: theme.colors.textSoft,
    lineHeight: 20,
  },
  button: {
    alignItems: "center",
    backgroundColor: theme.colors.primaryStrong,
    borderColor: theme.colors.primary,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50,
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
  helper: {
    color: theme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
});
