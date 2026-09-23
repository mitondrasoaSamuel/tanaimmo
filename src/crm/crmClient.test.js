import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createCrmClient, CrmClientError } from "./crmClient.js";

const lead = {
  listingId: "lst-42",
  name: "Rasoa",
  phone: "+261340000000",
  email: "rasoa@example.com",
  message: "Visite samedi ?",
};

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    headers: {
      get(name) {
        const key = Object.keys(headers).find(
          (k) => k.toLowerCase() === name.toLowerCase()
        );
        return key ? headers[key] : null;
      },
    },
    async json() {
      return body;
    },
  };
}

describe("crmClient.createLead", () => {
  it("réessaie après un 429 (Retry-After) puis réussit", async () => {
    const calls = [];
    const fetchImpl = mock.fn(async (_url, init) => {
      calls.push(init);
      if (calls.length === 1) {
        return jsonResponse(429, { error: "rate_limited" }, { "Retry-After": "0" });
      }
      return jsonResponse(201, { id: "lead-1", createdAt: "2026-09-22T12:00:00Z" });
    });

    const waits = [];
    const sleepImpl = (fn, ms) => {
      waits.push(ms);
      fn();
    };

    const client = createCrmClient({
      token: "test-token",
      fetchImpl,
      sleepImpl,
      maxAttempts: 3,
    });

    const result = await client.createLead(lead);

    assert.equal(result.id, "lead-1");
    assert.equal(fetchImpl.mock.callCount(), 2);
    assert.equal(waits.length, 1);
    assert.equal(waits[0], 0);
    assert.equal(calls[0].headers["Idempotency-Key"], calls[1].headers["Idempotency-Key"]);
    assert.match(calls[0].headers.Authorization, /^Bearer /);
  });

  it("abandonne après trois 500", async () => {
    const fetchImpl = mock.fn(async () => jsonResponse(500, { error: "boom" }));
    const sleepImpl = (fn) => fn();

    const client = createCrmClient({
      token: "test-token",
      fetchImpl,
      sleepImpl,
      maxAttempts: 3,
    });

    await assert.rejects(
      () => client.createLead(lead),
      (err) => {
        assert.ok(err instanceof CrmClientError);
        assert.equal(err.status, 500);
        assert.equal(err.retryable, true);
        assert.doesNotMatch(String(err.message), /test-token/);
        return true;
      }
    );
    assert.equal(fetchImpl.mock.callCount(), 3);
  });

  it("ne réessaie pas sur une 400 définitive", async () => {
    const fetchImpl = mock.fn(async () => jsonResponse(400, { error: "invalid" }));

    const client = createCrmClient({
      token: "test-token",
      fetchImpl,
      sleepImpl: (fn) => fn(),
      maxAttempts: 4,
    });

    await assert.rejects(() => client.createLead(lead), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.retryable, false);
      return true;
    });
    assert.equal(fetchImpl.mock.callCount(), 1);
  });
});
