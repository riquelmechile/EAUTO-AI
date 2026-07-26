import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { S3ObjectStorage } from "../packages/infrastructure/dist/index.js";

const body = Buffer.from("EAUTO-AI verified source image upload smoke", "utf8");
const checksumSha256Base64 = createHash("sha256").update(body).digest("base64");
const objectKey = `smoke/source-image-${Date.now()}.jpg`;
const endpoint = process.env.OBJECT_STORAGE_SMOKE_ENDPOINT ?? "http://127.0.0.1:9000";
const storage = new S3ObjectStorage({
  bucket: process.env.OBJECT_STORAGE_BUCKET ?? "eauto-content",
  region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1",
  publicEndpoint: endpoint,
  internalEndpoint: endpoint,
  accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "eauto",
  secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "change-me-now",
  forcePathStyle: true,
});

const signed = await storage.createPresignedUpload({
  objectKey,
  contentType: "image/jpeg",
  checksumSha256Base64,
  expiresInSeconds: 120,
});
const response = await fetch(signed.uploadUrl, {
  method: "PUT",
  headers: signed.requiredHeaders,
  body,
});
assert.equal(response.ok, true, `Signed PUT failed: ${response.status} ${await response.text()}`);

const observed = await storage.inspectObject(objectKey);
assert.deepEqual(observed, {
  exists: true,
  sizeBytes: body.byteLength,
  contentType: "image/jpeg",
  checksumSha256Base64,
  objectUri: `s3://${process.env.OBJECT_STORAGE_BUCKET ?? "eauto-content"}/${objectKey}`,
});

console.log("Object storage smoke passed: signed PUT, size, MIME and SHA-256 verified.");
