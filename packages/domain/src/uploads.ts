export const SOURCE_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type SourceImageContentType = (typeof SOURCE_IMAGE_CONTENT_TYPES)[number];

export type SourceImageUploadStatus = "requested" | "verified" | "expired" | "rejected";

export type SourceImageUpload = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  objectKey: string;
  originalFileName: string;
  contentType: SourceImageContentType;
  sizeBytes: number;
  checksumSha256Base64: string;
  status: SourceImageUploadStatus;
  objectUri: string | null;
  createdAt: string;
  expiresAt: string;
  verifiedAt: string | null;
  rejectionReason: string | null;
}>;

export type VerifiedSourceImageUpload = SourceImageUpload &
  Readonly<{
    status: "verified";
    objectUri: string;
    verifiedAt: string;
    rejectionReason: null;
  }>;

export type UploadSourceImageRequest = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  originalFileName: string;
  contentType: SourceImageContentType;
  sizeBytes: number;
  checksumSha256Base64: string;
}>;

export class UploadValidationError extends Error {
  readonly code = "invalid-upload";

  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export function validateSourceImageUploadRequest(
  request: UploadSourceImageRequest,
  maximumBytes: number,
): void {
  if (!SOURCE_IMAGE_CONTENT_TYPES.includes(request.contentType)) {
    throw new UploadValidationError(`Unsupported content type ${request.contentType}.`);
  }
  if (!Number.isSafeInteger(request.sizeBytes) || request.sizeBytes <= 0) {
    throw new UploadValidationError("Image size must be a positive safe integer.");
  }
  if (request.sizeBytes > maximumBytes) {
    throw new UploadValidationError(`Image exceeds the maximum size of ${maximumBytes} bytes.`);
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(request.checksumSha256Base64)) {
    throw new UploadValidationError("Checksum must be a base64-encoded SHA-256 digest.");
  }
  if (request.originalFileName.length < 1 || request.originalFileName.length > 255) {
    throw new UploadValidationError(
      "Original file name must contain between 1 and 255 characters.",
    );
  }
}

export function isVerifiedSourceImageUpload(
  upload: SourceImageUpload,
): upload is VerifiedSourceImageUpload {
  return (
    upload.status === "verified" &&
    upload.objectUri !== null &&
    upload.verifiedAt !== null &&
    upload.rejectionReason === null
  );
}

export function sourceImageExtension(contentType: SourceImageContentType): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}
