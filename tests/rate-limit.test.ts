import assert from "node:assert/strict";
import test from "node:test";
import { extractClientIp } from "../lib/rate-limit";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost/", { headers });
}

test("extractClientIp returns null when TRUST_PROXY_HEADERS is not set", () => {
  delete process.env.TRUST_PROXY_HEADERS;

  const req = makeRequest({ "cf-connecting-ip": "1.2.3.4" });
  assert.equal(extractClientIp(req), null);
});

test("extractClientIp returns null when TRUST_PROXY_HEADERS=false", () => {
  process.env.TRUST_PROXY_HEADERS = "false";

  const req = makeRequest({ "x-forwarded-for": "5.6.7.8" });
  assert.equal(extractClientIp(req), null);
});

test("extractClientIp prefers cf-connecting-ip when TRUST_PROXY_HEADERS=true", () => {
  process.env.TRUST_PROXY_HEADERS = "true";

  const req = makeRequest({
    "cf-connecting-ip": "1.2.3.4",
    "x-forwarded-for": "9.9.9.9, 10.0.0.1",
  });
  assert.equal(extractClientIp(req), "1.2.3.4");
});

test("extractClientIp falls back to first x-forwarded-for entry when TRUST_PROXY_HEADERS=true", () => {
  process.env.TRUST_PROXY_HEADERS = "true";

  const req = makeRequest({ "x-forwarded-for": " 5.6.7.8 , 10.0.0.1" });
  assert.equal(extractClientIp(req), "5.6.7.8");
});

test("extractClientIp returns null when no headers present and TRUST_PROXY_HEADERS=true", () => {
  process.env.TRUST_PROXY_HEADERS = "true";

  const req = makeRequest({});
  assert.equal(extractClientIp(req), null);
});
