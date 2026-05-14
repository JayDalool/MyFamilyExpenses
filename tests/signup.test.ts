import assert from "node:assert/strict";
import test from "node:test";
import type { ZodIssue } from "zod";
import { signupSchema } from "../lib/validation/auth";

test("signup schema lowercases email", () => {
  const result = signupSchema.safeParse({
    name: "Test User",
    email: "TEST@EXAMPLE.COM",
    password: "SecureP@ss1",
    confirmPassword: "SecureP@ss1",
  });
  assert.ok(
    result.success,
    `Expected success, got: ${!result.success && JSON.stringify(result.error.issues)}`,
  );
  assert.equal(result.data.email, "test@example.com");
});

test("signup schema trims name whitespace", () => {
  const result = signupSchema.safeParse({
    name: "  Test User  ",
    email: "test@example.com",
    password: "SecureP@ss1",
    confirmPassword: "SecureP@ss1",
  });
  assert.ok(result.success);
  assert.equal(result.data.name, "Test User");
});

test("signup schema rejects password mismatch", () => {
  const result = signupSchema.safeParse({
    name: "Test User",
    email: "test@example.com",
    password: "SecureP@ss1",
    confirmPassword: "DifferentPass",
  });
  assert.ok(!result.success);
  const issue = result.error.issues.find((e: ZodIssue) => e.path.includes("confirmPassword"));
  assert.ok(issue, "Expected a confirmPassword error");
  assert.match(issue.message, /do not match/i);
});

test("signup schema rejects password shorter than 8 characters", () => {
  const result = signupSchema.safeParse({
    name: "Test User",
    email: "test@example.com",
    password: "short",
    confirmPassword: "short",
  });
  assert.ok(!result.success);
  const issue = result.error.issues.find((e: ZodIssue) => e.path.includes("password"));
  assert.ok(issue, "Expected a password error");
});

test("signup schema rejects name shorter than 2 characters", () => {
  const result = signupSchema.safeParse({
    name: "A",
    email: "test@example.com",
    password: "SecureP@ss1",
    confirmPassword: "SecureP@ss1",
  });
  assert.ok(!result.success);
  const issue = result.error.issues.find((e: ZodIssue) => e.path.includes("name"));
  assert.ok(issue, "Expected a name error");
});

test("signup schema rejects invalid email", () => {
  const result = signupSchema.safeParse({
    name: "Test User",
    email: "not-an-email",
    password: "SecureP@ss1",
    confirmPassword: "SecureP@ss1",
  });
  assert.ok(!result.success);
  const issue = result.error.issues.find((e: ZodIssue) => e.path.includes("email"));
  assert.ok(issue, "Expected an email error");
});

test("signup schema accepts valid input", () => {
  const result = signupSchema.safeParse({
    name: "Jay D",
    email: "jay@example.com",
    password: "SecureP@ss1",
    confirmPassword: "SecureP@ss1",
  });
  assert.ok(result.success);
  assert.equal(result.data.name, "Jay D");
  assert.equal(result.data.email, "jay@example.com");
});
