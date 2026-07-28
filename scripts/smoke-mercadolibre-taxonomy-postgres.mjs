import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresMercadoLibreTaxonomySnapshotRepository } from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for taxonomy snapshot smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `taxonomy-org-${suffix}`;
const accountId = `taxonomy-account-${suffix}`;
const categoryId = "MLC1234";
const scope = Object.freeze({ organizationId, accountId, categoryId });

const categoryV1 = Object.freeze({
  id: categoryId,
  siteId: "MLC",
  name: "Esquiladoras",
  pathFromRoot: Object.freeze([
    Object.freeze({ id: "MLC1000", name: "Agro" }),
    Object.freeze({ id: categoryId, name: "Esquiladoras" }),
  ]),
  childrenCategoryIds: Object.freeze([]),
  listingAllowed: true,
  status: "enabled",
  evidence: Object.freeze({
    observedAt: "2026-07-28T15:00:00.000Z",
    sourceHash: "a".repeat(64),
  }),
});
const categoryV2 = Object.freeze({
  ...categoryV1,
  name: "Esquiladoras profesionales",
  evidence: Object.freeze({
    observedAt: "2026-07-28T16:00:00.000Z",
    sourceHash: "b".repeat(64),
  }),
});
const attributeSnapshot = Object.freeze({
  categoryId,
  attributes: Object.freeze([
    Object.freeze({
      id: "ITEM_CONDITION",
      name: "Condición",
      valueType: "list",
      required: true,
      fixed: false,
      allowedValues: Object.freeze([Object.freeze({ id: "2230284", name: "Nuevo" })]),
    }),
  ]),
  evidence: Object.freeze({
    observedAt: "2026-07-28T16:00:00.000Z",
    sourceHash: "c".repeat(64),
  }),
});

try {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Taxonomy snapshot smoke organization",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
      (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
     VALUES ($1,$2,$3,'mercadolibre','MLC',3000,'ask')`,
    [accountId, organizationId, "Taxonomy snapshot smoke account"],
  );

  const repository = new PostgresMercadoLibreTaxonomySnapshotRepository(pool);
  await repository.saveCategory({ ...scope, snapshot: categoryV1 });
  await repository.saveCategory({ ...scope, snapshot: categoryV1 });
  await repository.saveCategoryAttributes({ ...scope, snapshot: attributeSnapshot });
  await repository.saveCategoryAttributes({ ...scope, snapshot: attributeSnapshot });
  await repository.saveCategory({ ...scope, snapshot: categoryV2 });

  const latestCategory = await repository.getCategory(scope);
  const latestAttributes = await repository.getCategoryAttributes(scope);
  assert(latestCategory?.name === categoryV2.name, "newest category snapshot was not returned");
  assert(
    latestCategory?.evidence.sourceHash === categoryV2.evidence.sourceHash,
    "newest category evidence was not returned",
  );
  assert(
    latestAttributes?.attributes[0]?.id === "ITEM_CONDITION",
    "attribute snapshot was not restored",
  );

  const counts = await pool.query(
    `SELECT snapshot_kind, count(*)::int AS count
     FROM mercadolibre_taxonomy_snapshots
     WHERE organization_id = $1 AND account_id = $2 AND category_id = $3
     GROUP BY snapshot_kind`,
    [organizationId, accountId, categoryId],
  );
  const byKind = new Map(counts.rows.map((row) => [row.snapshot_kind, row.count]));
  assert(byKind.get("category") === 2, "category snapshots were not append-only and idempotent");
  assert(byKind.get("attributes") === 1, "attribute snapshots were not idempotent");

  const foreign = await repository.getCategory({
    organizationId: "maustian",
    accountId: "plasticov",
    categoryId,
  });
  assert(foreign === null, "taxonomy snapshot leaked across tenant scope");

  await repository
    .saveCategory({
      ...scope,
      snapshot: Object.freeze({ ...categoryV2, name: "Conflicting payload" }),
    })
    .then(() => {
      throw new Error("Conflicting taxonomy source hash unexpectedly succeeded.");
    })
    .catch((error) => {
      if (!String(error).includes("conflicts with another payload")) throw error;
    });

  console.log("✓ MercadoLibre taxonomy snapshot versions, idempotency and scope verified");
} finally {
  await pool
    .query(
      `DELETE FROM mercadolibre_taxonomy_snapshots
       WHERE organization_id = $1 AND account_id = $2`,
      [organizationId, accountId],
    )
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM commerce_accounts WHERE organization_id = $1 AND id = $2`, [
      organizationId,
      accountId,
    ])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM organizations WHERE id = $1`, [organizationId])
    .catch(() => undefined);
  await pool.end();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
