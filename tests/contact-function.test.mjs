import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import worker from "../public/_worker.js";

const originalFetch = globalThis.fetch;
const validPayload = {
  name: "Test Visitor",
  email: "visitor@example.com",
  company: "Example Company",
  service: "Website design",
  message: "I would like to discuss a new website for my company.",
  consent: "yes",
  fax: "",
  "cf-turnstile-response": "verified-token",
  requestId: "8c9d7e1a-8474-4a5a-8ae2-6adab4a97409",
};
const env = {
  RESEND_API_KEY: "test-resend-key",
  TURNSTILE_SECRET_KEY: "test-turnstile-key",
  CONTACT_FROM_EMAIL: "PixelFox Website <inquiries@send.pixelfox.design>",
  CONTACT_TO_EMAIL: "support@pixelfox.design",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(payload = validPayload, origin = "https://pixelfox.design") {
  return new Request("https://pixelfox.design/api/contact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": "203.0.113.12",
    },
    body: JSON.stringify(payload),
  });
}

async function body(response) {
  return response.json();
}

test("sends a validated inquiry through Resend", async () => {
  let delivered;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("turnstile")) {
      assert.equal(init.body.get("response"), "verified-token");
      return Response.json({ success: true, action: "contact", hostname: "pixelfox.design" });
    }

    delivered = JSON.parse(init.body);
    assert.equal(init.headers["Idempotency-Key"], validPayload.requestId);
    return Response.json({ id: "email_123" });
  };

  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal((await body(response)).ok, true);
  assert.equal(delivered.to[0], "support@pixelfox.design");
  assert.equal(delivered.reply_to, "visitor@example.com");
  assert.equal(delivered.from, env.CONTACT_FROM_EMAIL);
  assert.match(delivered.subject, /Test Visitor at Example Company/);
});

test("escapes visitor content in the HTML email", async () => {
  let delivered;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("turnstile")) {
      return Response.json({ success: true, action: "contact", hostname: "pixelfox.design" });
    }
    delivered = JSON.parse(init.body);
    return Response.json({ id: "email_123" });
  };

  const payload = { ...validPayload, message: "Please review <script>alert('no')</script> today." };
  const response = await worker.fetch(request(payload), env);
  assert.equal(response.status, 200);
  assert.doesNotMatch(delivered.html, /<script>/);
  assert.match(delivered.html, /&lt;script&gt;/);
});

test("silently accepts honeypot submissions without sending", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };

  const response = await worker.fetch(request({ ...validPayload, fax: "spam" }), {});
  assert.equal(response.status, 200);
  assert.equal((await body(response)).ok, true);
  assert.equal(calls, 0);
});

test("rejects invalid form values before external requests", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };

  const response = await worker.fetch(request({ ...validPayload, email: "not-an-email" }), env);
  assert.equal(response.status, 400);
  assert.equal((await body(response)).ok, false);
  assert.equal(calls, 0);
});

test("rejects cross-origin submissions", async () => {
  const response = await worker.fetch(request(validPayload, "https://attacker.example"), env);
  assert.equal(response.status, 403);
  assert.equal((await body(response)).ok, false);
});

test("requires a successful Turnstile check", async () => {
  globalThis.fetch = async () => Response.json({ success: false, action: "contact", hostname: "pixelfox.design" });

  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 400);
  assert.match((await body(response)).message, /security check/i);
});

test("returns a safe error when delivery fails", async () => {
  globalThis.fetch = async (input) => {
    if (String(input).includes("turnstile")) {
      return Response.json({ success: true, action: "contact", hostname: "pixelfox.design" });
    }
    return Response.json({ message: "sensitive provider detail" }, { status: 500 });
  };

  const response = await worker.fetch(request(), env);
  const result = await body(response);
  assert.equal(response.status, 502);
  assert.doesNotMatch(result.message, /sensitive provider detail/);
});

test("fails closed when production secrets are missing", async () => {
  const response = await worker.fetch(request(), {});
  assert.equal(response.status, 503);
  assert.match((await body(response)).message, /temporarily unavailable/i);
});
