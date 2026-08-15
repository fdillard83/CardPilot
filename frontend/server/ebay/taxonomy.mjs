import { EbayApiError } from "./oauth-client.mjs";

const TAXONOMY_ROOT = "https://api.ebay.com/commerce/taxonomy/v1";

async function readJson(response) {
  return response.json().catch(() => null);
}

export class EbayTaxonomyClient {
  constructor({ oauthClient, marketplaceId = "EBAY_US", fetchImpl = fetch }) {
    this.oauthClient = oauthClient;
    this.marketplaceId = marketplaceId;
    this.fetch = fetchImpl;
    this.categoryTreeId = null;
    this.cache = new Map();
  }

  async suggestCategories(query) {
    if (typeof query !== "string" || !query.trim()) throw new TypeError("A category description is required.");
    const key = query.trim().toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    const treeId = await this.#treeId();
    const payload = await this.#request(`${TAXONOMY_ROOT}/category_tree/${encodeURIComponent(treeId)}/get_category_suggestions?q=${encodeURIComponent(query.trim())}`);
    const suggestions = (payload?.categorySuggestions ?? []).slice(0, 8).map((item) => ({
      id: item.category?.categoryId,
      name: item.category?.categoryName,
      breadcrumb: [...(item.categoryTreeNodeAncestors ?? [])]
        .reverse()
        .map((ancestor) => ancestor.categoryName)
        .filter(Boolean)
        .concat(item.category?.categoryName ?? [])
        .join(" > "),
    })).filter((item) => item.id && item.name);
    this.cache.set(key, suggestions);
    return suggestions;
  }

  async #treeId() {
    if (this.categoryTreeId) return this.categoryTreeId;
    const payload = await this.#request(`${TAXONOMY_ROOT}/get_default_category_tree_id?marketplace_id=${encodeURIComponent(this.marketplaceId)}`);
    if (!payload?.categoryTreeId) throw new EbayApiError("eBay did not return a category tree.", { service: "taxonomy" });
    this.categoryTreeId = payload.categoryTreeId;
    return this.categoryTreeId;
  }

  async #request(url) {
    let accessToken = await this.oauthClient.getAccessToken();
    let response = await this.fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId } });
    if (response.status === 401) {
      this.oauthClient.invalidate(accessToken);
      accessToken = await this.oauthClient.getAccessToken();
      response = await this.fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId } });
    }
    const payload = await readJson(response);
    if (!response.ok) throw new EbayApiError("eBay category recommendations are temporarily unavailable.", {
      service: "taxonomy", status: response.status, code: payload?.errors?.[0]?.errorId?.toString(),
    });
    return payload;
  }
}
