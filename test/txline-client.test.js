import test from "node:test";
import assert from "node:assert/strict";
import { TxLineClient } from "../src/txline-client.js";

test("renews an expired guest JWT and retries an API request", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), authorization: options.headers?.Authorization });
    if (String(url).endsWith("/auth/guest/start")) {
      return new Response(JSON.stringify({ token: "fresh-jwt" }), { status: 200 });
    }
    if (calls.filter((call) => call.url.includes("fixtures/snapshot")).length === 1) {
      return new Response("expired", { status: 401 });
    }
    return new Response(JSON.stringify([{ fixtureId: 1 }]), { status: 200 });
  };

  try {
    const client = new TxLineClient({
      baseUrl: "https://example.test",
      jwt: "expired-jwt",
      apiToken: "api-token",
      fixtureId: 1,
    });
    const fixtures = await client.fixtures();
    assert.deepEqual(fixtures, [{ fixtureId: 1 }]);
    assert.equal(client.jwt, "fresh-jwt");
    assert.equal(calls.at(-1).authorization, "Bearer fresh-jwt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
