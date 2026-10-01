import assert from "node:assert/strict";
import test from "node:test";
import { isNativeFormRequest, readJsonOrFormPayload } from "../lib/http/form-request";

test("readJsonOrFormPayload reads native POST form data", async () => {
  const request = new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      _csrf: "token",
      email: "user@example.com",
      password: "SecurePass123",
    }),
  });

  assert.equal(isNativeFormRequest(request), true);
  assert.deepEqual(await readJsonOrFormPayload(request), {
    _csrf: "token",
    email: "user@example.com",
    password: "SecurePass123",
  });
});

test("readJsonOrFormPayload preserves JSON API requests", async () => {
  const request = new Request("http://localhost/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Groceries" }),
  });

  assert.equal(isNativeFormRequest(request), false);
  assert.deepEqual(await readJsonOrFormPayload(request), { name: "Groceries" });
});
