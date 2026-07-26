import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStoragePort } from "@eauto/application";

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly signingClient: S3Client;
  private readonly inspectionClient: S3Client;

  constructor(
    private readonly config: Readonly<{
      bucket: string;
      region: string;
      publicEndpoint?: string;
      internalEndpoint?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle?: boolean;
    }>,
  ) {
    this.signingClient = new S3Client(this.clientConfig(config.publicEndpoint));
    this.inspectionClient = new S3Client(
      this.clientConfig(config.internalEndpoint ?? config.publicEndpoint),
    );
  }

  async createPresignedUpload(input: {
    objectKey: string;
    contentType: string;
    checksumSha256Base64: string;
    expiresInSeconds: number;
  }): Promise<Readonly<{ uploadUrl: string; requiredHeaders: Readonly<Record<string, string>> }>> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ChecksumSHA256: input.checksumSha256Base64,
      Metadata: { sha256: input.checksumSha256Base64 },
    });
    const uploadUrl = await getSignedUrl(this.signingClient, command, {
      expiresIn: input.expiresInSeconds,
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      signableHeaders: new Set(["content-type"]),
    });
    return Object.freeze({
      uploadUrl,
      requiredHeaders: Object.freeze({
        "content-type": input.contentType,
        "x-amz-checksum-sha256": input.checksumSha256Base64,
      }),
    });
  }

  async inspectObject(objectKey: string): Promise<
    Readonly<{
      exists: boolean;
      sizeBytes: number | null;
      contentType: string | null;
      checksumSha256Base64: string | null;
      objectUri: string;
    }>
  > {
    try {
      const result = await this.inspectionClient.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
          ChecksumMode: "ENABLED",
        }),
      );
      return Object.freeze({
        exists: true,
        sizeBytes: result.ContentLength ?? null,
        contentType: result.ContentType ?? null,
        checksumSha256Base64: result.ChecksumSHA256 ?? result.Metadata?.sha256 ?? null,
        objectUri: `s3://${this.config.bucket}/${objectKey}`,
      });
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "$metadata" in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
          : undefined;
      if (statusCode === 404) {
        return Object.freeze({
          exists: false,
          sizeBytes: null,
          contentType: null,
          checksumSha256Base64: null,
          objectUri: `s3://${this.config.bucket}/${objectKey}`,
        });
      }
      throw error;
    }
  }

  private clientConfig(endpoint: string | undefined): S3ClientConfig {
    const credentials =
      this.config.accessKeyId && this.config.secretAccessKey
        ? {
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
          }
        : undefined;
    return {
      region: this.config.region,
      ...(endpoint ? { endpoint } : {}),
      ...(credentials ? { credentials } : {}),
      ...(this.config.forcePathStyle === undefined
        ? {}
        : { forcePathStyle: this.config.forcePathStyle }),
    };
  }
}
