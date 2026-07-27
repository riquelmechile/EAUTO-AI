import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations.");

const directory = resolve(process.cwd(), "infra/postgres/migrations");
const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("SELECT pg_advisory_lock($1)", [7_204_221_901]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      content_hash text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  for (const filename of files) {
    const sql = await readFile(resolve(directory, filename), "utf8");
    const contentHash = createHash("sha256").update(sql, "utf8").digest("hex");
    const existing = await client.query(
      "SELECT content_hash FROM schema_migrations WHERE filename = $1",
      [filename],
    );
    const previousHash = existing.rows[0]?.content_hash;
    if (previousHash) {
      if (previousHash !== contentHash) {
        throw new Error(`Applied migration ${filename} changed after deployment.`);
      }
      console.log(`✓ ${filename} already applied`);
      continue;
    }
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename, content_hash) VALUES ($1, $2)",
      [filename, contentHash],
    );
    console.log(`✓ ${filename} applied`);
  }
} finally {
  await client.query("SELECT pg_advisory_unlock($1)", [7_204_221_901]).catch(() => undefined);
  await client.end();
}
