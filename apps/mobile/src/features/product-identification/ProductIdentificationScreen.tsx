import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Panel } from "../../components/Panel";
import {
  api,
  type ProductIdentificationReview,
  type StoredProductIdentification,
} from "../../lib/api";
import { uploadVerifiedSourceImage, type LocalSourceImage } from "../../lib/sourceImageUpload";

const ACCOUNTS = [
  { id: "plasticov", name: "Plasticov" },
  { id: "maustian", name: "Maustian" },
] as const;

type Props = Readonly<{ roles: readonly string[] }>;

export function ProductIdentificationScreen({ roles }: Props) {
  const canIdentify = roles.some(
    (role) => role === "owner" || role === "admin" || role === "operator",
  );
  const canReview = roles.some(
    (role) => role === "owner" || role === "admin" || role === "reviewer",
  );
  const [accountId, setAccountId] = useState<(typeof ACCOUNTS)[number]["id"]>("plasticov");
  const [image, setImage] = useState<LocalSourceImage | null>(null);
  const [identification, setIdentification] = useState<StoredProductIdentification | null>(null);
  const [review, setReview] = useState<ProductIdentificationReview | null>(null);
  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("");
  const [policyVersion, setPolicyVersion] = useState("");
  const [status, setStatus] = useState("Selecciona una cuenta y una foto del producto.");
  const [working, setWorking] = useState<"identify" | "confirm" | "reject" | null>(null);

  function changeAccount(nextAccountId: (typeof ACCOUNTS)[number]["id"]): void {
    setAccountId(nextAccountId);
    resetResult();
    setStatus(`Cuenta ${accountName(nextAccountId)} seleccionada.`);
  }

  async function selectImage(camera: boolean): Promise<void> {
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    const mimeType = normalizeImageMimeType(asset.mimeType, asset.uri);
    if (!mimeType) {
      setImage(null);
      resetResult();
      setStatus("La imagen debe ser JPEG, PNG o WebP.");
      return;
    }
    setImage({
      uri: asset.uri,
      fileName: asset.fileName ?? `producto.${extensionFor(mimeType)}`,
      mimeType,
      ...(asset.fileSize === undefined ? {} : { fileSize: asset.fileSize }),
    });
    resetResult();
    setStatus("Imagen lista. El servidor verificará el objeto antes de identificar.");
  }

  async function identify(): Promise<void> {
    if (!image) {
      setStatus("Falta una imagen.");
      return;
    }
    if (!canIdentify) {
      setStatus("Tu rol puede inspeccionar, pero no solicitar identificaciones.");
      return;
    }
    setWorking("identify");
    setReview(null);
    try {
      const uploaded = await uploadVerifiedSourceImage({
        accountId,
        image,
        onStatus: setStatus,
      });
      setStatus("Analizando evidencia verificada y buscando duplicados…");
      const response = await api.identifyProduct({
        accountId,
        sourceImageUploadId: uploaded.uploadId,
      });
      setIdentification(response.identification);
      setMode(response.mode);
      setPolicyVersion(response.policyVersion);
      const candidate = response.identification.result.selectedCandidate;
      setProductId(candidate ? suggestedProductId(candidate.id) : "");
      setReason("");
      setStatus(resultMessage(response.identification));
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setWorking(null);
    }
  }

  async function submitReview(decision: "confirmed" | "rejected"): Promise<void> {
    const candidate = identification?.result.selectedCandidate;
    if (!identification || !candidate) {
      setStatus("No existe una identificación clara para revisar.");
      return;
    }
    if (!canReview) {
      setStatus("Tu rol puede consultar, pero no confirmar ni rechazar.");
      return;
    }
    if (decision === "confirmed" && !productId.trim()) {
      setStatus("La confirmación requiere un Product ID explícito.");
      return;
    }
    if (decision === "rejected" && !reason.trim()) {
      setStatus("El rechazo requiere un motivo.");
      return;
    }
    setWorking(decision === "confirmed" ? "confirm" : "reject");
    try {
      const result = await api.reviewProductIdentification({
        identificationId: identification.id,
        accountId,
        candidateId: candidate.id,
        ...(decision === "confirmed"
          ? {
              decision,
              productId: productId.trim(),
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            }
          : { decision, reason: reason.trim() }),
      });
      setReview(result);
      setStatus(
        result.decision === "confirmed"
          ? `Producto confirmado como ${result.productId ?? "sin ID"}. No se publicó nada.`
          : "Identificación rechazada. La decisión quedó registrada como terminal.",
      );
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setWorking(null);
    }
  }

  function resetResult(): void {
    setIdentification(null);
    setReview(null);
    setProductId("");
    setReason("");
    setMode("");
    setPolicyVersion("");
  }

  const result = identification?.result ?? null;
  const candidate = result?.selectedCandidate ?? null;
  const reviewable = Boolean(candidate && result?.requiresHumanConfirmation && !review);

  return (
    <View style={styles.stack}>
      <Panel title="Identificación de producto">
        <Text style={styles.intro}>
          Foto → evidencia verificada → candidatos → revisión humana. Esta pantalla no publica,
          compra ni modifica MercadoLibre.
        </Text>
        <View style={styles.readOnlyBadge}>
          <Text style={styles.readOnlyText}>CONTROL HUMANO OBLIGATORIO</Text>
        </View>

        <Text style={styles.label}>Cuenta comercial</Text>
        <View style={styles.row}>
          {ACCOUNTS.map((account) => (
            <Pressable
              accessibilityRole="button"
              disabled={working !== null}
              key={account.id}
              onPress={() => changeAccount(account.id)}
              style={[styles.accountButton, accountId === account.id && styles.accountButtonActive]}
            >
              <Text style={styles.buttonText}>{account.name}</Text>
            </Pressable>
          ))}
        </View>

        {image ? <Image source={{ uri: image.uri }} style={styles.preview} /> : null}
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            disabled={working !== null}
            onPress={() => void selectImage(true)}
            style={[styles.secondary, working !== null && styles.disabled]}
          >
            <Text style={styles.buttonText}>Cámara</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={working !== null}
            onPress={() => void selectImage(false)}
            style={[styles.secondary, working !== null && styles.disabled]}
          >
            <Text style={styles.buttonText}>Galería</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={!image || !canIdentify || working !== null}
          onPress={() => void identify()}
          style={[
            styles.primary,
            (!image || !canIdentify || working !== null) && styles.disabled,
          ]}
        >
          <Text style={styles.buttonText}>
            {working === "identify" ? "Identificando…" : "Identificar producto"}
          </Text>
        </Pressable>
        {!canIdentify ? (
          <Text style={styles.permission}>Tu rol no puede iniciar una identificación.</Text>
        ) : null}
        <Text style={styles.status}>{status}</Text>
      </Panel>

      {identification && result ? (
        <Panel title="Resultado gobernado">
          <Detail label="Identification ID" value={identification.id} mono />
          <Detail label="Estado" value={statusLabel(result.status)} />
          <Detail label="Cuenta" value={accountName(result.accountId)} />
          <Detail label="Policy" value={policyVersion || result.policyVersion} />
          <Detail label="Modo" value={mode || "desconocido"} />
          <Detail
            label="Fingerprint"
            value={`${identification.fingerprint.algorithm} · ${identification.fingerprint.version}`}
          />
          {result.reasons.length > 0 ? (
            <Detail label="Razones" value={result.reasons.join(" · ")} />
          ) : null}
          {result.blockingDuplicate ? (
            <View style={styles.alertBox}>
              <Text style={styles.alertTitle}>Duplicado bloqueante</Text>
              <Text style={styles.meta}>
                {result.blockingDuplicate.productId} · {formatBps(result.blockingDuplicate.similarityBps)}
              </Text>
            </View>
          ) : null}
          {candidate ? <CandidateCard candidate={candidate} title="Candidato seleccionado" /> : null}
          {result.alternativeCandidates.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Alternativas</Text>
              {result.alternativeCandidates.slice(0, 5).map((alternative) => (
                <CandidateCard candidate={alternative} key={alternative.id} title="Alternativa" />
              ))}
            </View>
          ) : null}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Evidencia ({result.evidenceRefs.length})</Text>
            {result.evidenceRefs.slice(0, 8).map((reference) => (
              <Text key={reference} selectable style={styles.evidence}>
                {reference}
              </Text>
            ))}
          </View>
        </Panel>
      ) : null}

      {candidate && result?.requiresHumanConfirmation ? (
        <Panel title="Decisión humana">
          {review ? (
            <View style={styles.reviewBox}>
              <Text style={styles.reviewTitle}>
                {review.decision === "confirmed" ? "Confirmado" : "Rechazado"}
              </Text>
              <Text style={styles.meta}>
                {review.reviewerId} · {formatDate(review.decidedAt)}
              </Text>
              {review.productId ? <Text style={styles.meta}>Product ID: {review.productId}</Text> : null}
              {review.reason ? <Text style={styles.meta}>Motivo: {review.reason}</Text> : null}
            </View>
          ) : (
            <>
              <Text style={styles.label}>Product ID al confirmar</Text>
              <TextInput
                accessibilityLabel="Product ID confirmado"
                autoCapitalize="none"
                editable={reviewable && canReview && working === null}
                onChangeText={setProductId}
                placeholder="catalog_product_id"
                placeholderTextColor="#64748b"
                style={styles.input}
                value={productId}
              />
              <Text style={styles.label}>Motivo o nota</Text>
              <TextInput
                accessibilityLabel="Motivo de revisión"
                editable={reviewable && canReview && working === null}
                multiline
                onChangeText={setReason}
                placeholder="Obligatorio al rechazar; opcional al confirmar"
                placeholderTextColor="#64748b"
                style={[styles.input, styles.reasonInput]}
                value={reason}
              />
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!reviewable || !canReview || working !== null}
                  onPress={() => void submitReview("confirmed")}
                  style={[
                    styles.confirm,
                    (!reviewable || !canReview || working !== null) && styles.disabled,
                  ]}
                >
                  <Text style={styles.buttonText}>
                    {working === "confirm" ? "Confirmando…" : "Confirmar"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={!reviewable || !canReview || working !== null}
                  onPress={() => void submitReview("rejected")}
                  style={[
                    styles.reject,
                    (!reviewable || !canReview || working !== null) && styles.disabled,
                  ]}
                >
                  <Text style={styles.buttonText}>
                    {working === "reject" ? "Rechazando…" : "Rechazar"}
                  </Text>
                </Pressable>
              </View>
              {!canReview ? (
                <Text style={styles.permission}>Tu rol puede consultar, pero no revisar.</Text>
              ) : null}
            </>
          )}
        </Panel>
      ) : null}
    </View>
  );
}

function CandidateCard({
  candidate,
  title,
}: Readonly<{
  candidate: StoredProductIdentification["result"]["alternativeCandidates"][number];
  title: string;
}>) {
  return (
    <View style={styles.candidate}>
      <Text style={styles.candidateLabel}>{title}</Text>
      <Text style={styles.candidateName}>{candidate.canonicalName}</Text>
      <Text style={styles.meta}>
        {candidate.brand ?? "Marca no determinada"}
        {candidate.model ? ` · ${candidate.model}` : ""}
      </Text>
      <Text style={styles.meta}>
        {candidate.categoryHint ?? "Categoría no determinada"} · confianza {formatBps(candidate.confidenceBps)}
      </Text>
      <Text selectable style={styles.evidence}>
        {candidate.id}
      </Text>
    </View>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable={mono} style={[styles.detailValue, mono && styles.mono]}>
        {value}
      </Text>
    </View>
  );
}

function resultMessage(identification: StoredProductIdentification): string {
  switch (identification.result.status) {
    case "identified-pending-confirmation":
      return "Candidato claro encontrado. Requiere confirmación humana antes de usar su identidad.";
    case "ambiguous":
      return "La evidencia es ambigua. No se puede confirmar automáticamente.";
    case "no-match":
      return "No se encontró un candidato con confianza suficiente.";
    case "duplicate-blocked":
      return "La imagen coincide con un producto confirmado y quedó bloqueada como duplicado.";
    case "incomplete":
      return "La evidencia está incompleta o vencida. No se creó una identidad.";
  }
}

function statusLabel(status: StoredProductIdentification["result"]["status"]): string {
  switch (status) {
    case "identified-pending-confirmation":
      return "Pendiente de confirmación";
    case "ambiguous":
      return "Ambiguo";
    case "no-match":
      return "Sin coincidencia";
    case "duplicate-blocked":
      return "Duplicado bloqueado";
    case "incomplete":
      return "Evidencia incompleta";
  }
}

function suggestedProductId(candidateId: string): string {
  const normalized = candidateId.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `catalog_${normalized || Date.now().toString(36)}`;
}

function accountName(accountId: string): string {
  return ACCOUNTS.find((account) => account.id === accountId)?.name ?? accountId;
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-CL");
}

function readError(error: unknown): string {
  if (!(error instanceof Error)) return "Falló Product Identification.";
  const match = error.message.match(/"message":"([^"]+)"/);
  return match?.[1] ?? error.message;
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
  intro: { color: "#cbd5e1", lineHeight: 20 },
  readOnlyBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#164e63",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  readOnlyText: { color: "#a5f3fc", fontSize: 11, fontWeight: "900" },
  label: { color: "#cbd5e1", fontSize: 12, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10 },
  accountButton: {
    alignItems: "center",
    backgroundColor: "#334155",
    borderRadius: 12,
    flex: 1,
    padding: 11,
  },
  accountButtonActive: { backgroundColor: "#0369a1" },
  preview: { aspectRatio: 1.3, borderRadius: 14, width: "100%" },
  secondary: {
    alignItems: "center",
    backgroundColor: "#334155",
    borderRadius: 12,
    flex: 1,
    padding: 12,
  },
  primary: { alignItems: "center", backgroundColor: "#2563eb", borderRadius: 12, padding: 14 },
  confirm: {
    alignItems: "center",
    backgroundColor: "#15803d",
    borderRadius: 12,
    flex: 1,
    padding: 13,
  },
  reject: {
    alignItems: "center",
    backgroundColor: "#b91c1c",
    borderRadius: 12,
    flex: 1,
    padding: 13,
  },
  disabled: { opacity: 0.45 },
  buttonText: { color: "white", fontWeight: "700" },
  permission: { color: "#fbbf24", fontSize: 12 },
  status: { color: "#bae6fd", lineHeight: 20 },
  detail: { borderBottomColor: "#334155", borderBottomWidth: 1, gap: 3, paddingBottom: 9 },
  detailLabel: { color: "#94a3b8", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  detailValue: { color: "#f8fafc", lineHeight: 20 },
  mono: { fontFamily: "monospace", fontSize: 11 },
  alertBox: { backgroundColor: "#451a03", borderRadius: 12, gap: 4, padding: 12 },
  alertTitle: { color: "#fdba74", fontWeight: "800" },
  section: { gap: 9 },
  sectionTitle: { color: "#e2e8f0", fontSize: 14, fontWeight: "800" },
  candidate: { backgroundColor: "#0f172a", borderRadius: 12, gap: 4, padding: 12 },
  candidateLabel: { color: "#7dd3fc", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  candidateName: { color: "#f8fafc", fontSize: 16, fontWeight: "800" },
  meta: { color: "#94a3b8", lineHeight: 18 },
  evidence: { color: "#94a3b8", fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
  input: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderRadius: 12,
    borderWidth: 1,
    color: "white",
    padding: 12,
  },
  reasonInput: { minHeight: 82, textAlignVertical: "top" },
  reviewBox: { backgroundColor: "#052e16", borderRadius: 12, gap: 5, padding: 13 },
  reviewTitle: { color: "#86efac", fontSize: 16, fontWeight: "900" },
});
