import { once } from "node:events";
import { app } from "./index.mjs";

const server = app.listen(0);
await once(server, "listening");

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("The smoke-test server did not bind to a TCP port.");
}

const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const health = await healthResponse.json();

  if (!healthResponse.ok || health.ok !== true) {
    throw new Error("The health endpoint did not return a healthy response.");
  }

  const homeResponse = await fetch(baseUrl);
  const home = await homeResponse.text();

  if (!homeResponse.ok || !home.includes("CardPilot")) {
    throw new Error("The production server did not serve the CardPilot build.");
  }

  const identifyResponse = await fetch(`${baseUrl}/api/identify-card`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const expectedStatus = process.env.OPENAI_API_KEY ? 400 : 503;
  if (identifyResponse.status !== expectedStatus) {
    throw new Error(`The identification endpoint returned ${identifyResponse.status}; expected ${expectedStatus}.`);
  }

  console.log("CardPilot server smoke test passed.");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
