import assert from "node:assert/strict";
import test from "node:test";
import {
  GoogleWebEvidenceProvider,
  googleVisionConfiguration,
  WebEvidenceOrchestrator,
} from "./web-evidence-provider.mjs";

const intake = {
  frontImage: "data:image/jpeg;base64,Y2FyZA==",
  backImage: null,
  frontDetailImages: [],
};

test("Google web evidence normalizes full matches and caches identical cards", async () => {
  let requests = 0;
  const provider = new GoogleWebEvidenceProvider({
    credentials: {},
    projectId: "cardpilot-vision",
    auth: { getAccessToken: async () => "token" },
    fetchImpl: async (_url, options) => {
      requests += 1;
      assert.equal(options.headers.Authorization, "Bearer token");
      assert.equal(options.headers["x-goog-user-project"], "cardpilot-vision");
      return new Response(JSON.stringify({
        responses: [{ webDetection: {
          bestGuessLabels: [{ label: "2025 Topps Nick Kurtz Power Players" }],
          pagesWithMatchingImages: [{
            url: "https://example.com/card",
            pageTitle: "2025 Topps Nick Kurtz Power Players PP-30",
            fullMatchingImages: [{ url: "https://example.com/card.jpg" }],
          }],
        } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const first = await provider.analyze(intake);
  const second = await provider.analyze(intake);
  assert.equal(requests, 1);
  assert.deepEqual(second, first);
  assert.equal(first.signals[0].type, "full_matching_page");
  assert.match(first.signals[0].text, /Nick Kurtz/);
});

test("Google configuration remains disabled unless explicitly enabled", () => {
  assert.equal(googleVisionConfiguration({ GOOGLE_VISION_ENABLED: "false" }), null);
});

test("Google configuration accepts Base64 service-account JSON", () => {
  const credentials = {
    type: "service_account",
    project_id: "cardpilot-vision",
    client_email: "vision@example.test",
    private_key: "private",
  };
  const configuration = googleVisionConfiguration({
    GOOGLE_VISION_ENABLED: "true",
    GOOGLE_CLOUD_CREDENTIALS_BASE64: Buffer.from(JSON.stringify(credentials)).toString("base64"),
  });
  assert.equal(configuration.projectId, "cardpilot-vision");
  assert.equal(configuration.timeoutMs, 3_000);
});

test("a degraded web provider never blocks other identification sources", async () => {
  const orchestrator = new WebEvidenceOrchestrator({
    providers: [{ name: "replaceable_test_provider", analyze: async () => { throw new Error("offline"); } }],
  });
  const [result] = await orchestrator.analyze(intake);
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.signals, []);
});
