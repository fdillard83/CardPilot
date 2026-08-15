import assert from "node:assert/strict";
import test from "node:test";
import { EbayTaxonomyClient } from "./taxonomy.mjs";

test("taxonomy suggestions use production categories and preserve breadcrumbs", async () => {
  const requests = [];
  const oauthClient = { getAccessToken: async () => "token", invalidate() {} };
  const client = new EbayTaxonomyClient({ oauthClient, fetchImpl: async (url) => {
    requests.push(url);
    if (url.includes("get_default_category_tree_id")) return Response.json({ categoryTreeId: "0" });
    return Response.json({ categorySuggestions: [{
      category: { categoryId: "261328", categoryName: "Sports Trading Cards" },
      categoryTreeNodeAncestors: [{ categoryName: "Sports Memorabilia, Cards & Fan Shop" }],
    }] });
  } });
  const suggestions = await client.suggestCategories("baseball trading card");
  assert.equal(suggestions[0].id, "261328");
  assert.match(suggestions[0].breadcrumb, /Sports Trading Cards$/);
  assert.equal(requests.length, 2);
  await client.suggestCategories("baseball trading card");
  assert.equal(requests.length, 2);
});
