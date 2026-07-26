import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStoragePort } from "@eauto/application";

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly client: S3Client;

  constructor(
    private readonly config: Readonly<{
      bucket: string;
      region: string;
      endpoint?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle?: boolean;
    }>,
  ) {
    const credentials =
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined;
    const clientConfig: S3ClientConfig = {
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(credentials ? { credentials } : {}),
      ...(config.forcePathStyle === undefined ? {} : { forcePathStyle: config.forcePathStyle }),
    };
    this.client = new S3Client(clientConfig);
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
    const uploadUrl = await getSignedUrl(this.client, command, {
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
      const result = await this.client.send(
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
}
