import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import type { MobileSession } from "../../lib/session";

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
    <View style={styles.container}>
      <Text style={styles.brand}>EAUTO-AI</Text>
      <Text style={styles.title}>Acceso seguro del CEO</Text>
      <Text style={styles.description}>
        Ingrese una sola vez el código de enrolamiento. La aplicación guardará únicamente una sesión
        revocable dentro del almacenamiento cifrado del dispositivo.
      </Text>
      <TextInput
        accessibilityLabel="Código de enrolamiento"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setToken}
        placeholder="Código de enrolamiento"
        placeholderTextColor="#64748b"
        secureTextEntry
        style={styles.input}
        value={token}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={() => void enroll()}
        style={[styles.button, submitting && styles.buttonDisabled]}
      >
        {submitting ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>Ingresar</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#111827",
    borderRadius: 20,
    gap: 14,
    margin: 20,
    padding: 24,
  },
  brand: { color: "#7dd3fc", fontSize: 14, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: "#f8fafc", fontSize: 25, fontWeight: "900" },
  description: { color: "#cbd5e1", lineHeight: 21 },
  input: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderRadius: 12,
    borderWidth: 1,
    color: "white",
    padding: 14,
  },
  error: { color: "#fca5a5", lineHeight: 20 },
  button: { alignItems: "center", backgroundColor: "#2563eb", borderRadius: 12, padding: 14 },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: "white", fontWeight: "800" },
});
