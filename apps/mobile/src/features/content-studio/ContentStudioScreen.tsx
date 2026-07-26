import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Panel } from "../../components/Panel";
import { api } from "../../lib/api";
import { uploadVerifiedSourceImage, type LocalSourceImage } from "../../lib/sourceImageUpload";

export function ContentStudioScreen() {
  const [image, setImage] = useState<LocalSourceImage | null>(null);
  const [instructions, setInstructions] = useState("");
  const [status, setStatus] = useState("Selecciona o toma una foto del producto.");
  const [working, setWorking] = useState(false);

  const selectImage = async (camera: boolean) => {
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    const mimeType = normalizeImageMimeType(asset.mimeType, asset.uri);
    if (!mimeType) {
      setImage(null);
      setStatus("La imagen debe ser JPEG, PNG o WebP.");
      return;
    }
    setImage({
      uri: asset.uri,
      fileName: asset.fileName ?? `producto.${extensionFor(mimeType)}`,
      mimeType,
      ...(asset.fileSize === undefined ? {} : { fileSize: asset.fileSize }),
    });
    setStatus("Imagen lista. Se verificará antes de crear el lanzamiento.");
  };

  const createLaunch = async () => {
    if (!image) {
      setStatus("Falta una imagen.");
      return;
    }
    setWorking(true);
    try {
      const uploaded = await uploadVerifiedSourceImage({
        accountId: "plasticov",
        image,
        onStatus: setStatus,
      });
      setStatus("Creando activos del lanzamiento…");
      const result = await api.createLaunch({
        id: `launch_${Date.now()}`,
        accountId: "plasticov",
        sourceImageUploadId: uploaded.uploadId,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      });
      setStatus(
        `${result.assets.length} activos preparados desde una imagen verificada. No se publicó nada.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falló la preparación.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <View style={styles.stack}>
      <Panel title="Content Studio">
        {image ? <Image source={{ uri: image.uri }} style={styles.preview} /> : null}
        <View style={styles.row}>
          <Pressable
            disabled={working}
            onPress={() => void selectImage(true)}
            style={styles.secondary}
          >
            <Text style={styles.buttonText}>Cámara</Text>
          </Pressable>
          <Pressable
            disabled={working}
            onPress={() => void selectImage(false)}
            style={styles.secondary}
          >
            <Text style={styles.buttonText}>Galería</Text>
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel="Instrucciones del lanzamiento"
          editable={!working}
          multiline
          onChangeText={setInstructions}
          placeholder="Ej.: enfoque premium, fondo claro, publicar en Plasticov"
          placeholderTextColor="#64748b"
          style={styles.input}
          value={instructions}
        />
        <Pressable
          disabled={working}
          onPress={() => void createLaunch()}
          style={[styles.primary, working && styles.disabled]}
        >
          <Text style={styles.buttonText}>{working ? "Procesando…" : "Preparar lanzamiento"}</Text>
        </Pressable>
        <Text style={styles.status}>{status}</Text>
      </Panel>
    </View>
  );
}

function normalizeImageMimeType(
  mimeType: string | undefined,
  uri: string,
): LocalSourceImage["mimeType"] | null {
  if (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp") {
    return mimeType;
  }
  const normalizedUri = uri.toLowerCase().split("?")[0] ?? uri.toLowerCase();
  if (normalizedUri.endsWith(".jpg") || normalizedUri.endsWith(".jpeg")) return "image/jpeg";
  if (normalizedUri.endsWith(".png")) return "image/png";
  if (normalizedUri.endsWith(".webp")) return "image/webp";
  return null;
}

function extensionFor(mimeType: LocalSourceImage["mimeType"]): string {
  return mimeType === "image/jpeg" ? "jpg" : (mimeType.split("/")[1] ?? "img");
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
  disabled: { opacity: 0.6 },
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
