export const PRODUCT_FINGERPRINT_ALGORITHMS = ["phash-64", "sha256-prefix-64"] as const;
export type ProductFingerprintAlgorithm = (typeof PRODUCT_FINGERPRINT_ALGORITHMS)[number];

export type ProductVisualFingerprint = Readonly<{
  algorithm: ProductFingerprintAlgorithm;
  version: string;
  value: string;
  evidenceRef: string;
}>;

export function validateProductVisualFingerprint(
  fingerprint: ProductVisualFingerprint,
): ProductVisualFingerprint {
  if (!PRODUCT_FINGERPRINT_ALGORITHMS.includes(fingerprint.algorithm)) {
    throw new Error(`Unsupported product fingerprint algorithm ${fingerprint.algorithm}.`);
  }
  if (!fingerprint.version.trim()) throw new Error("Product fingerprint version is required.");
  if (!/^[01]{64}$/.test(fingerprint.value)) {
    throw new Error("Product fingerprint value must contain exactly 64 binary digits.");
  }
  if (!fingerprint.evidenceRef.trim()) {
    throw new Error("Product fingerprint evidenceRef is required.");
  }
  return Object.freeze({ ...fingerprint });
}

export function calculateProductFingerprintSimilarityBps(
  algorithm: ProductFingerprintAlgorithm,
  left: string,
  right: string,
): number {
  assertFingerprintBits(left, right);
  if (algorithm === "sha256-prefix-64") return left === right ? 10_000 : 0;
  return calculateVisualSimilarityBps(left, right);
}

export function calculateVisualSimilarityBps(left: string, right: string): number {
  assertFingerprintBits(left, right);
  let equalBits = 0;
  for (let index = 0; index < 64; index += 1) {
    if (left[index] === right[index]) equalBits += 1;
  }
  return Math.trunc((equalBits * 10_000) / 64);
}

function assertFingerprintBits(left: string, right: string): void {
  if (!/^[01]{64}$/.test(left) || !/^[01]{64}$/.test(right)) {
    throw new Error("Fingerprint similarity requires two 64-bit binary fingerprints.");
  }
}
