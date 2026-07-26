import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Panel } from "../../components/Panel";
import { api } from "../../lib/api";

export function ContentStudioScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [status, setStatus] = useState("Selecciona o toma una foto del producto.");

  const selectImage = async (camera: boolean) => {
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (!result.canceled) setImageUri(result.assets[0]?.uri ?? null);
  };

  const createLaunch = async () => {
    if (!imageUri) {
      setStatus("Falta una imagen.");
      return;
    }
    setStatus("Preparando lanzamiento…");
    try {
      const result = await api.createLaunch({
        id: `launch_${Date.now()}`,
        accountId: "plasticov",
        sourceImageUri: imageUri,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      });
      setStatus(`${result.assets.length} activos preparados para revisión. No se publicó nada.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falló la preparación.");
    }
  };

  return (
    <View style={styles.stack}>
      <Panel title="Content Studio">
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} /> : null}
        <View style={styles.row}>
          <Pressable onPress={() => void selectImage(true)} style={styles.secondary}>
            <Text style={styles.buttonText}>Cámara</Text>
          </Pressable>
          <Pressable onPress={() => void selectImage(false)} style={styles.secondary}>
            <Text style={styles.buttonText}>Galería</Text>
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel="Instrucciones del lanzamiento"
          multiline
          onChangeText={setInstructions}
          placeholder="Ej.: enfoque premium, fondo claro, publicar en Plasticov"
          placeholderTextColor="#64748b"
          style={styles.input}
          value={instructions}
        />
        <Pressable onPress={() => void createLaunch()} style={styles.primary}>
          <Text style={styles.buttonText}>Preparar lanzamiento</Text>
        </Pressable>
        <Text style={styles.status}>{status}</Text>
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  preview: { aspectRatio: 1.3, borderRadius: 14, width: "100%" },
  row: { flexDirection: "row", gap: 10 },
  secondary: {
    alignItems: "center",
    backgroundColor: "#334155",
    borderRadius: 12,
    flex: 1,
    padding: 12,
  },
  primary: { alignItems: "center", backgroundColor: "#2563eb", borderRadius: 12, padding: 14 },
  buttonText: { color: "white", fontWeight: "700" },
  input: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderRadius: 12,
    borderWidth: 1,
    color: "white",
    minHeight: 100,
    padding: 12,
    textAlignVertical: "top",
  },
  status: { color: "#bae6fd", lineHeight: 20 },
});
