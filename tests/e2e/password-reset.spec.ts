import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../lib/auth/password";
import { assertSafeTestDatabase } from "../helpers/test-database";

assertSafeTestDatabase();
test.beforeEach(() => {
  assertSafeTestDatabase();
});

async function createAccount(db: PrismaClient, suffix: string) {
  const email = `e2e-reset-${suffix}-${crypto.randomUUID()}@example.com`;
  const password = "OriginalPass1!";
  const user = await db.user.create({
    data: {
      name: "E2E Reset User",
      email,
      passwordHash: await hashPassword(password),
    },
  });
  const household = await db.household.create({
    data: { name: `E2E Reset HH ${crypto.randomUUID()}` },
  });
  await db.membership.create({
    data: { userId: user.id, householdId: household.id, role: "OWNER" },
  });
  return { email, password, user, household };
}

async function cleanupAccount(
  db: PrismaClient,
  fixture: Awaited<ReturnType<typeof createAccount>>,
) {
  assertSafeTestDatabase();
  await db.auditLog.deleteMany({
    where: { OR: [{ userId: fixture.user.id }, { householdId: fixture.household.id }] },
  });
  await db.passwordResetToken.deleteMany({ where: { userId: fixture.user.id } });
  await db.session.deleteMany({ where: { userId: fixture.user.id } });
  await db.membership.deleteMany({ where: { householdId: fixture.household.id } });
  await db.household.delete({ where: { id: fixture.household.id } });
  await db.user.delete({ where: { id: fixture.user.id } });
  await db.passwordResetRateLimitAttempt.deleteMany({});
}

test("forgot/reset password full UI flow updates the password and login works", async ({ page }) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createAccount(db, "happy");

  try {
    await page.goto("/auth/forgot-password");
    await page.getByLabel("Email address").fill(fixture.email);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/forgot-password") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send reset link" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(202);
    const body = (await response.json()) as {
      data?: { previewUrl?: string; message?: string };
    };
    expect(body.data?.message).toMatch(/If an account exists for that email/i);
    expect(body.data?.previewUrl).toBeTruthy();

    const resetUrl = body.data!.previewUrl!;
    await page.goto(resetUrl);
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();

    const newPassword = "ChangedPass1!";
    await page.getByLabel("New password").fill(newPassword);
    await page.getByLabel("Confirm password").fill(newPassword);
    await Promise.all([
      page.waitForURL("**/auth/login**"),
      page.getByRole("button", { name: "Update password" }).click(),
    ]);

    await expect(page.locator("text=Password updated. Sign in with your new password.")).toBeVisible();

    await page.getByLabel("Email address").fill(fixture.email);
    await page.getByLabel("Password").fill(newPassword);
    await Promise.all([
      page.waitForURL("**/dashboard"),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);
  } finally {
    await cleanupAccount(db, fixture);
    await db.$disconnect();
  }
});

test("forgot-password returns the same generic message for an unknown email", async ({ page }) => {
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email address").fill(`absolutely-nobody-${crypto.randomUUID()}@example.com`);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/forgot-password") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send reset link" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  const body = (await response.json()) as { data?: { message?: string } };
  expect(body.data?.message).toMatch(/If an account exists for that email/i);
});

test("reset-password page rejects an invalid token with the generic message", async ({ page }) => {
  await page.goto("/auth/reset-password?token=" + "a".repeat(64));
  await expect(
    page.locator("text=This password reset link is invalid or has expired"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Request a new reset link" })).toBeVisible();
});

test("a used reset token can no longer be redeemed", async ({ page }) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createAccount(db, "replay");
  try {
    await page.goto("/auth/forgot-password");
    await page.getByLabel("Email address").fill(fixture.email);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/forgot-password") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send reset link" }).click();
    const response = await responsePromise;
    const body = (await response.json()) as { data?: { previewUrl?: string } };
    const resetUrl = body.data!.previewUrl!;
    expect(resetUrl).toBeTruthy();

    await page.goto(resetUrl);
    const newPassword = "Replayed1!";
    await page.getByLabel("New password").fill(newPassword);
    await page.getByLabel("Confirm password").fill(newPassword);
    await Promise.all([
      page.waitForURL("**/auth/login**"),
      page.getByRole("button", { name: "Update password" }).click(),
    ]);

    // Now try to use the same URL again — the page must show invalid.
    await page.goto(resetUrl);
    await expect(
      page.locator("text=This password reset link is invalid or has expired"),
    ).toBeVisible();
  } finally {
    await cleanupAccount(db, fixture);
    await db.$disconnect();
  }
});
