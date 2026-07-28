import { afterEach, describe, expect, it, vi } from "vitest";
import { MercadoLibreTaxonomyHttpReader } from "@eauto/infrastructure";

const config = Object.freeze({
  apiBaseUrl: "https://api.mercadolibre.com",
  timeoutMs: 5_000,
  maximumResponseBytes: 100_000,
});
const scope = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  categoryId: "MLC1234",
});

function reader() {
  return new MercadoLibreTaxonomyHttpReader(config, () => new Date("2026-07-28T16:00:00.000Z"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MercadoLibreTaxonomyHttpReader", () => {
  it("normalizes a category and owns evidence metadata locally", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "MLC1234",
          name: "Esquiladoras",
          organizationId: "attacker",
          observedAt: "2000-01-01T00:00:00.000Z",
          sourceHash: "attacker-hash",
          path_from_root: [
            { id: "MLC1000", name: "Agro" },
            { id: "MLC1234", name: "Esquiladoras" },
          ],
          children_categories: [],
          settings: { listing_allowed: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const category = await reader().getCategory(scope);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.mercadolibre.com/categories/MLC1234"),
      expect.objectContaining({ redirect: "error" }),
    );
    expect(category).toMatchObject({
      id: "MLC1234",
      siteId: "MLC",
      listingAllowed: true,
      status: "enabled",
      evidence: { observedAt: "2026-07-28T16:00:00.000Z" },
    });
    expect(category?.evidence.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(category).not.toHaveProperty("organizationId");
  });

  it("normalizes required, fixed and allowed attribute values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: "ITEM_CONDITION",
              name: "Condición",
              value_type: "list",
              tags: { required: true, fixed: true, organizationId: "attacker" },
              values: [
                { id: "2230284", name: "Nuevo" },
                { id: 2230581, name: "Usado" },
              ],
            },
          ]),
          { status: 200 },
        ),
      ),
    );

    const result = await reader().getCategoryAttributes(scope);

    expect(result).toMatchObject({
      categoryId: "MLC1234",
      attributes: [
        {
          id: "ITEM_CONDITION",
          valueType: "list",
          required: true,
          fixed: true,
          allowedValues: [
            { id: "2230284", name: "Nuevo" },
            { id: "2230581", name: "Usado" },
          ],
        },
      ],
      evidence: { observedAt: "2026-07-28T16:00:00.000Z" },
    });
  });

  it("rejects a category payload for another category", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "MLC9999",
            name: "Foreign",
            path_from_root: [],
            children_categories: [],
            settings: { listing_allowed: true },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(reader().getCategory(scope)).rejects.toThrow(/does not match/);
  });

  it("rejects non-Chile category IDs before calling fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(reader().getCategory({ ...scope, categoryId: "MLA1234" })).rejects.toThrow(
      /Chile category ID/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported attribute value types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify([{ id: "X", name: "X", value_type: "json", tags: {}, values: [] }]),
          { status: 200 },
        ),
      ),
    );
    await expect(reader().getCategoryAttributes(scope)).rejects.toThrow(/Unsupported/);
  });

  it("rejects invalid JSON and HTTP errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(reader().getCategoryAttributes(scope)).rejects.toThrow(/invalid JSON/);
    await expect(reader().getCategory(scope)).rejects.toThrow(/429/);
  });

  it("rejects responses larger than the configured byte limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("x".repeat(101), {
          status: 200,
          headers: { "content-length": "101" },
        }),
      ),
    );
    const smallReader = new MercadoLibreTaxonomyHttpReader({ ...config, maximumResponseBytes: 100 });
    await expect(smallReader.getCategory(scope)).rejects.toThrow(/byte limit/);
  });
});
