import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.OBJECT_STORAGE_INTERNAL_ENDPOINT;
const bucket = process.env.OBJECT_STORAGE_BUCKET;
const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY;
const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_KEY;
if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error("Object storage initialization requires endpoint, bucket and credentials.");
}
const client = new S3Client({
  endpoint,
  region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1",
  forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
  credentials: { accessKeyId, secretAccessKey },
});

for (let attempt = 1; attempt <= 60; attempt += 1) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    break;
  } catch (error) {
    if (attempt === 60) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (createError) {
        throw new AggregateError([error, createError], "Object storage bucket is unavailable.");
      }
      break;
    }
    if (attempt === 1) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        break;
      } catch {
        // MinIO may still be starting. Retry without leaking credentials.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

await client.send(
  new PutBucketVersioningCommand({
    Bucket: bucket,
    VersioningConfiguration: { Status: "Enabled" },
  }),
);
console.log(`✓ object storage bucket ${bucket} is ready with versioning`);
