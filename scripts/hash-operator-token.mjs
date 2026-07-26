import { createHash } from "node:crypto";

const token = process.argv[2] ?? process.env.OPERATOR_TOKEN;
if (!token) {
  console.error("Usage: node scripts/hash-operator-token.mjs <token>");
  process.exitCode = 1;
} else {
  console.log(createHash("sha256").update(token, "utf8").digest("hex"));
}
