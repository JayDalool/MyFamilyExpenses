import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../lib/auth/csrf";
import { proxy } from "../proxy";

const URL_ = "http://localhost/api/expenses/category-suggestion";
const token = "a".repeat(40);

function post(headers: Record<string, string>) {
  return new NextRequest(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ vendor: "Costco" }),
  });
}

test("category-suggestion POST without a CSRF header is rejected", async () => {
  const res = await proxy(post({ cookie: `${CSRF_COOKIE_NAME}=${token}` }));
  assert.equal(res.status, 403);
});

test("category-suggestion POST with a mismatched CSRF header is rejected", async () => {
  const res = await proxy(
    post({ cookie: `${CSRF_COOKIE_NAME}=${token}`, [CSRF_HEADER_NAME]: "b".repeat(40) }),
  );
  assert.equal(res.status, 403);
});

test("category-suggestion POST with a matching CSRF header passes the proxy", async () => {
  const res = await proxy(
    post({ cookie: `${CSRF_COOKIE_NAME}=${token}`, [CSRF_HEADER_NAME]: token }),
  );
  assert.notEqual(res.status, 403);
});
