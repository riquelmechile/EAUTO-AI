import * as Crypto from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { api } from "./api";

export type LocalSourceImage = Readonly<{
  uri: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  fileSize?: number;
}>;

export async function uploadVerifiedSourceImage(input: {
  accountId: string;
  image: LocalSourceImage;
  onStatus?(status: string): void;
}): Promise<Readonly<{ uploadId: string; objectUri: string }>> {
  const file = new File(input.image.uri);
  const sizeBytes = input.image.fileSize ?? file.size;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("No fue posible determinar el tamaño de la imagen.");
  }

  input.onStatus?.("Calculando integridad SHA-256…");
  const bytes = await file.bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const checksumSha256Base64 = arrayBufferToBase64(digest);
  const uploadId = `source_${Date.now()}_${Crypto.randomUUID()}`;

  input.onStatus?.("Solicitando carga segura…");
  const requested = await api.requestSourceImageUpload({
    id: uploadId,
    accountId: input.accountId,
    originalFileName: input.image.fileName,
    contentType: input.image.mimeType,
    sizeBytes,
    checksumSha256Base64,
  });

  input.onStatus?.("Subiendo imagen cifrada en tránsito…");
  const uploadResponse = await expoFetch(requested.uploadUrl, {
    method: "PUT",
    headers: requested.requiredHeaders,
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`La carga segura falló con estado ${uploadResponse.status}.`);
  }

  input.onStatus?.("Verificando tamaño, tipo y checksum…");
  const verified = await api.completeSourceImageUpload({
    id: uploadId,
    accountId: input.accountId,
  });
  return Object.freeze({ uploadId, objectUri: verified.objectUri });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
