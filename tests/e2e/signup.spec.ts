import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "../../lib/auth/password";

async function createE2EAccount(db: PrismaClient) {
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  const password = "NoScriptPass123";
  const user = await db.user.create({
    data: { name: "Phase One E2E", email, passwordHash: await hashPassword(password) },
  });
  const household = await db.household.create({
    data: { name: `Phase One E2E ${crypto.randomUUID()}` },
  });
  await db.membership.create({
    data: { userId: user.id, householdId: household.id, role: "OWNER" },
  });

  return { email, password, user, household };
}

async function cleanupE2EAccount(
  db: PrismaClient,
  fixture: Awaited<ReturnType<typeof createE2EAccount>>,
) {
  await db.auditLog.deleteMany({
    where: { OR: [{ userId: fixture.user.id }, { householdId: fixture.household.id }] },
  });
  await db.session.deleteMany({ where: { userId: fixture.user.id } });
  await db.expense.deleteMany({ where: { householdId: fixture.household.id } });
  await db.category.deleteMany({ where: { householdId: fixture.household.id } });
  await db.membership.deleteMany({ where: { householdId: fixture.household.id } });
  await db.household.delete({ where: { id: fixture.household.id } });
  await db.user.delete({ where: { id: fixture.user.id } });
}

test("signup page submits and shows the verification success state", async ({ page }) => {
  await page.route("**/api/auth/signup", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();

    const payload = route.request().postDataJSON() as Record<string, string>;

    expect(payload.name).toBe("Taylor User");
    expect(payload.email).toBe("TAYLOR@example.com");
    expect(payload.password).toBe("SecurePass123");
    expect(payload.confirmPassword).toBe("SecurePass123");

    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          status: "verification_sent",
          message: "Check your email for a verification link to finish creating your account.",
          previewUrl: "http://localhost:3001/api/auth/signup/verify?token=dev-token",
        },
      }),
    });
  });

  await page.goto("/auth/signup");
  await page.getByLabel("Full name").fill("Taylor User");
  await page.getByLabel("Email address").fill("TAYLOR@example.com");
  await page.getByLabel("Password", { exact: true }).fill("SecurePass123");
  await page.getByLabel("Confirm password").fill("SecurePass123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByText("Check your email for a verification link to finish creating your account."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the local verification link" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("signup page shows rate-limit errors returned by the server", async ({ page }) => {
  // Duplicate emails no longer leak via 409 — the API now returns the same 202
  // "verification_sent" body whether or not the account exists, to prevent
  // email enumeration. Generic 4xx errors (rate limit, validation) still surface.
  await page.route("**/api/auth/signup", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();

    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "Too many attempts. Please try again later.",
        },
      }),
    });
  });

  await page.goto("/auth/signup");
  await page.getByLabel("Full name").fill("Taylor User");
  await page.getByLabel("Email address").fill("taylor@example.com");
  await page.getByLabel("Password", { exact: true }).fill("SecurePass123");
  await page.getByLabel("Confirm password").fill("SecurePass123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Too many attempts. Please try again later.")).toBeVisible();
});

test("signup page treats an already-registered email as a regular 'check your email' success", async ({
  page,
}) => {
  // Email enumeration mitigation: the API responds 202 with the same body even
  // when the email is already registered. The UI should show the check-email
  // state, not a "this email exists" error.
  await page.route("**/api/auth/signup", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();

    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          status: "verification_sent",
          message:
            "Check your email for a verification link to finish creating your account.",
        },
      }),
    });
  });

  await page.goto("/auth/signup");
  await page.getByLabel("Full name").fill("Taylor User");
  await page.getByLabel("Email address").fill("taylor@example.com");
  await page.getByLabel("Password", { exact: true }).fill("SecurePass123");
  await page.getByLabel("Confirm password").fill("SecurePass123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByText("Check your email for a verification link to finish creating your account."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open the local verification link" }),
  ).toHaveCount(0);
});

test("login page hides OAuth buttons when providers are disabled", async ({ page }) => {
  await page.goto("/auth/login");

  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue with Microsoft" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
});

test("login page submits credentials with POST and keeps them out of the URL", async ({ page }) => {
  await page.route("**/api/auth/login", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();

    const payload = route.request().postDataJSON() as Record<string, string>;
    expect(payload.email).toBe("taylor@example.com");
    expect(payload.password).toBe("SecurePass123");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: {
            id: "user-1",
            name: "Taylor User",
            email: "taylor@example.com",
            role: "USER",
          },
        },
      }),
    });
  });

  await page.goto("/auth/login");
  await page.getByLabel("Email address").fill("taylor@example.com");
  await page.getByLabel("Password").fill("SecurePass123");
  const requestPromise = page.waitForRequest("**/api/auth/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await requestPromise;

  expect(page.url()).not.toContain("SecurePass123");
  expect(page.url()).not.toContain("taylor%40example.com");
});

test("signup form fallback sends a protected POST without exposing credentials in the URL", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3001",
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  let submitted = false;

  await page.route("**/api/auth/signup", async (route) => {
    submitted = true;
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["content-type"]).toContain(
      "application/x-www-form-urlencoded",
    );
    const form = new URLSearchParams(route.request().postData() ?? "");
    expect(form.get("_csrf")).toBeTruthy();
    expect(form.get("email")).toBe("noscript@example.com");
    expect(form.get("password")).toBe("NoScriptPass123");

    await route.fulfill({
      status: 303,
      headers: { location: "/auth/signup?status=verification_sent" },
    });
  });

  await page.goto("/auth/signup");
  await expect(page.locator("form")).toHaveAttribute("method", "post");
  await expect(page.locator("form")).toHaveAttribute("action", "/api/auth/signup");
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  await page.getByLabel("Full name").fill("No Script User");
  await page.getByLabel("Email address").fill("noscript@example.com");
  await page.getByLabel("Password", { exact: true }).fill("NoScriptPass123");
  await page.getByLabel("Confirm password").fill("NoScriptPass123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/auth/signup?status=verification_sent");

  const url = new URL(page.url());
  expect(submitted).toBe(true);
  expect(page.url()).not.toContain("NoScriptPass123");
  expect(page.url()).not.toContain("noscript%40example.com");

  await context.close();
});

test("login form fallback sends a protected POST without exposing credentials in the URL", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3001",
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  let submitted = false;

  await page.route("**/api/auth/login", async (route) => {
    submitted = true;
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["content-type"]).toContain(
      "application/x-www-form-urlencoded",
    );
    const form = new URLSearchParams(route.request().postData() ?? "");
    expect(form.get("_csrf")).toBeTruthy();
    expect(form.get("email")).toBe("noscript@example.com");
    expect(form.get("password")).toBe("NoScriptPass123");

    await route.fulfill({
      status: 303,
      headers: { location: "/auth/login?error=login_failed" },
    });
  });

  await page.goto("/auth/login");
  await expect(page.locator("form").first()).toHaveAttribute("method", "post");
  await expect(page.locator("form").first()).toHaveAttribute("action", "/api/auth/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  await page.getByLabel("Email address").fill("noscript@example.com");
  await page.getByLabel("Password").fill("NoScriptPass123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/auth/login?error=login_failed");

  expect(submitted).toBe(true);
  expect(page.url()).not.toContain("NoScriptPass123");
  expect(page.url()).not.toContain("noscript%40example.com");

  await context.close();
});

test("normal pages deny framing while expense file routes allow same-origin framing", async ({
  request,
}) => {
  const pageResponse = await request.get("/auth/login");
  expect(pageResponse.headers()["x-frame-options"]).toBe("DENY");
  expect(pageResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");

  const fileResponse = await request.get(
    "/api/expenses/00000000-0000-0000-0000-000000000000/file",
  );
  expect(fileResponse.status()).toBe(401);
  expect(fileResponse.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(fileResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
});

test("category form sends a protected native POST without JavaScript", async ({ browser }) => {
  test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is required.");

  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createE2EAccount(db);

  const context = await browser.newContext({
    baseURL: "http://localhost:3001",
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  const categoryName = `Native ${crypto.randomUUID()}`;
  let categoryPostSeen = false;

  page.on("request", (request) => {
    if (request.url().endsWith("/api/categories") && request.method() === "POST") {
      categoryPostSeen = true;
      const form = new URLSearchParams(request.postData() ?? "");
      expect(form.get("_csrf")).toBeTruthy();
      expect(form.get("name")).toBe(categoryName);
    }
  });

  try {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/categories");
    await expect(page.locator("form")).toHaveAttribute("action", "/api/categories");
    await expect(page.getByRole("button", { name: "Create category" })).toBeEnabled();
    await page.getByLabel("New category").fill(categoryName);
    await page.getByRole("button", { name: "Create category" }).click();
    await page.waitForURL("**/categories?status=created");

    expect(categoryPostSeen).toBe(true);
    expect(page.url()).not.toContain(encodeURIComponent(categoryName));
    expect(
      await db.category.count({
        where: { householdId: fixture.household.id, name: categoryName },
      }),
    ).toBe(1);

    const category = await db.category.findFirstOrThrow({
      where: { householdId: fixture.household.id, name: categoryName },
    });
    const csrfToken = (await context.cookies()).find((cookie) => cookie.name === "mfe_csrf")?.value;
    expect(csrfToken).toBeTruthy();
    expect(
      (
        await context.request.patch(`/api/categories/${category.id}`, {
          headers: { "x-csrf-token": csrfToken! },
          data: { sortOrder: 9 },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await context.request.delete(`/api/categories/${category.id}`, {
          headers: { "x-csrf-token": csrfToken! },
        })
      ).ok(),
    ).toBe(true);

    const categoryAuditActions = await db.auditLog.findMany({
      where: {
        householdId: fixture.household.id,
        action: { in: ["category.create", "category.update", "category.delete"] },
      },
      select: { action: true },
    });
    expect(categoryAuditActions.map((entry) => entry.action).sort()).toEqual([
      "category.create",
      "category.delete",
      "category.update",
    ]);
  } finally {
    await context.close();
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});

test("failed logout shows an error and does not redirect", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is required.");

  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createE2EAccount(db);

  try {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await page.route("**/api/auth/logout", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Logout service unavailable." } }),
      });
    });

    await page.getByRole("button", { name: "Logout" }).first().click();
    await expect(page.getByText("Logout service unavailable.").first()).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
  } finally {
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});

test("authenticated PDF preview and download responses keep correct framing and disposition", async ({
  page,
}) => {
  test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is required.");

  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createE2EAccount(db);
  const category = await db.category.create({
    data: { householdId: fixture.household.id, name: `PDF ${crypto.randomUUID()}` },
  });
  const fileName = `${crypto.randomUUID()}.pdf`;
  const absolutePath = path.join(process.cwd(), "uploads", fileName);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, "%PDF-1.4\n%%EOF\n");
  const expense = await db.expense.create({
    data: {
      userId: fixture.user.id,
      householdId: fixture.household.id,
      categoryId: category.id,
      invoiceNumber: "PDF-E2E",
      invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
      amount: 10,
      filePath: `uploads/${fileName}`,
    },
  });

  try {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto(`/expenses/${expense.id}`);
    await expect(page.locator(`iframe[src="/api/expenses/${expense.id}/file"]`)).toBeVisible();

    const preview = await page.request.get(`/api/expenses/${expense.id}/file`);
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-type"]).toContain("application/pdf");
    expect(preview.headers()["content-disposition"]).toContain("inline");
    expect(preview.headers()["x-frame-options"]).toBe("SAMEORIGIN");

    const download = await page.request.get(`/api/expenses/${expense.id}/file?download=1`);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
  } finally {
    await unlink(absolutePath).catch(() => undefined);
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});

test("expense create, update, and soft delete routes create audit logs", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is required.");

  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createE2EAccount(db);
  const category = await db.category.create({
    data: { householdId: fixture.household.id, name: `Expense audit ${crypto.randomUUID()}` },
  });
  let uploadedPath: string | null = null;

  try {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    const csrfToken = (await page.context().cookies()).find(
      (cookie) => cookie.name === "mfe_csrf",
    )?.value;
    expect(csrfToken).toBeTruthy();

    const createResponse = await page.request.post("/api/expenses", {
      headers: { "x-csrf-token": csrfToken! },
      multipart: {
        categoryId: category.id,
        invoiceNumber: "AUDIT-CREATE",
        invoiceDate: "2026-06-01",
        amount: "12.34",
        file: {
          name: "audit.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
        },
      },
    });
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as {
      data: { expense: { id: string; filePath: string } };
    };
    uploadedPath = created.data.expense.filePath;

    const updateResponse = await page.request.patch(
      `/api/expenses/${created.data.expense.id}`,
      {
        headers: { "x-csrf-token": csrfToken! },
        data: {
          categoryId: category.id,
          invoiceNumber: "AUDIT-UPDATE",
          invoiceDate: "2026-06-02",
          amount: 15.5,
        },
      },
    );
    expect(updateResponse.ok()).toBe(true);

    const deleteResponse = await page.request.delete(
      `/api/expenses/${created.data.expense.id}`,
      { headers: { "x-csrf-token": csrfToken! } },
    );
    expect(deleteResponse.ok()).toBe(true);
    expect((await page.request.get(`/api/expenses/${created.data.expense.id}`)).status()).toBe(404);

    const deleted = await db.expense.findUniqueOrThrow({
      where: { id: created.data.expense.id },
    });
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deletedByUserId).toBe(fixture.user.id);

    const auditActions = await db.auditLog.findMany({
      where: {
        householdId: fixture.household.id,
        action: { in: ["expense.create", "expense.update", "expense.delete"] },
      },
      select: { action: true },
    });
    expect(auditActions.map((entry) => entry.action).sort()).toEqual([
      "expense.create",
      "expense.delete",
      "expense.update",
    ]);
  } finally {
    if (uploadedPath) {
      await unlink(path.join(process.cwd(), uploadedPath)).catch(() => undefined);
    }
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});
