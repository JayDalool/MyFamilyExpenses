import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "../../lib/auth/password";
import { createInviteToken, hashInviteToken } from "../../lib/household-invites";
import { assertSafeTestDatabase } from "../helpers/test-database";

assertSafeTestDatabase();
test.beforeEach(() => {
  assertSafeTestDatabase();
});

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
  assertSafeTestDatabase();
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
    const renamedCategoryName = `Renamed ${crypto.randomUUID()}`;
    expect(
      (
        await context.request.patch(`/api/categories/${category.id}`, {
          headers: { "x-csrf-token": csrfToken! },
          data: { name: renamedCategoryName },
        })
      ).ok(),
    ).toBe(true);
    await expect.poll(async () =>
      (
        await db.category.findUniqueOrThrow({ where: { id: category.id } })
      ).name,
    ).toBe(renamedCategoryName);

    const usedCategory = await db.category.create({
      data: { householdId: fixture.household.id, name: `Used ${crypto.randomUUID()}` },
    });
    await db.expense.create({
      data: {
        userId: fixture.user.id,
        householdId: fixture.household.id,
        categoryId: usedCategory.id,
        invoiceNumber: "CATEGORY-IN-USE",
        invoiceDate: new Date("2026-06-07T00:00:00.000Z"),
        amount: 1,
        filePath: "uploads/category-in-use.pdf",
      },
    });
    const hardDeleteResponse = await context.request.delete(`/api/categories/${category.id}`, {
      headers: { "x-csrf-token": csrfToken! },
    });
    expect(hardDeleteResponse.ok()).toBe(true);
    expect((await hardDeleteResponse.json()).meta.mode).toBe("deleted");
    expect(await db.category.findUnique({ where: { id: category.id } })).toBeNull();

    const disableResponse = await context.request.delete(`/api/categories/${usedCategory.id}`, {
      headers: { "x-csrf-token": csrfToken! },
    });
    expect(disableResponse.ok()).toBe(true);
    expect((await disableResponse.json()).meta.mode).toBe("disabled");
    expect(
      (await db.category.findUniqueOrThrow({ where: { id: usedCategory.id } })).status,
    ).toBe("DISABLED");

    const categoryAuditActions = await db.auditLog.findMany({
      where: {
        householdId: fixture.household.id,
        action: {
          in: ["category.create", "category.update", "category.delete", "category.disable"],
        },
      },
      select: { action: true },
    });
    expect(categoryAuditActions.map((entry) => entry.action).sort()).toEqual([
      "category.create",
      "category.delete",
      "category.disable",
      "category.update",
    ]);
  } finally {
    await context.close();
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});

test("failed logout shows an error and does not redirect", async ({ page }) => {
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

test("dashboard totals update after expense create, edit, and delete", async ({ page }) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createE2EAccount(db);
  const category = await db.category.create({
    data: { householdId: fixture.household.id, name: `Dashboard ${crypto.randomUUID()}` },
  });
  let uploadedPath: string | null = null;
  const today = new Date().toISOString().slice(0, 10);

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
        invoiceNumber: "DASH-CREATE",
        invoiceDate: today,
        amount: "11.25",
        file: {
          name: "dashboard.pdf",
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

    await page.goto("/dashboard");
    await expect(page.getByText("$11.25").first()).toBeVisible();

    const updateResponse = await page.request.patch(
      `/api/expenses/${created.data.expense.id}`,
      {
        headers: { "x-csrf-token": csrfToken! },
        data: {
          categoryId: category.id,
          invoiceNumber: "DASH-UPDATE",
          invoiceDate: today,
          amount: 22.5,
        },
      },
    );
    expect(updateResponse.ok()).toBe(true);
    await page.reload();
    await expect(page.getByText("$22.50").first()).toBeVisible();

    const deleteResponse = await page.request.delete(
      `/api/expenses/${created.data.expense.id}`,
      { headers: { "x-csrf-token": csrfToken! } },
    );
    expect(deleteResponse.ok()).toBe(true);
    await page.reload();
    await expect(page.getByText("$0.00").first()).toBeVisible();
  } finally {
    if (uploadedPath) {
      await unlink(path.join(process.cwd(), uploadedPath)).catch(() => undefined);
    }
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});

test("multi-household users only see the selected household on dashboard and reports", async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createE2EAccount(db);
  const secondHousehold = await db.household.create({
    data: { name: `Second Household ${crypto.randomUUID()}` },
  });
  await db.membership.create({
    data: { userId: fixture.user.id, householdId: secondHousehold.id, role: "MEMBER" },
  });
  const [categoryA, categoryB] = await Promise.all([
    db.category.create({
      data: { householdId: fixture.household.id, name: `First ${crypto.randomUUID()}` },
    }),
    db.category.create({
      data: { householdId: secondHousehold.id, name: `Second ${crypto.randomUUID()}` },
    }),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  await db.expense.createMany({
    data: [
      {
        userId: fixture.user.id,
        householdId: fixture.household.id,
        categoryId: categoryA.id,
        invoiceNumber: "HOUSEHOLD-A",
        invoiceDate: new Date(`${today}T00:00:00.000Z`),
        amount: 10,
        filePath: "uploads/household-a.pdf",
      },
      {
        userId: fixture.user.id,
        householdId: secondHousehold.id,
        categoryId: categoryB.id,
        invoiceNumber: "HOUSEHOLD-B",
        invoiceDate: new Date(`${today}T00:00:00.000Z`),
        amount: 100,
        filePath: "uploads/household-b.pdf",
      },
    ],
  });

  try {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await expect(page.getByLabel("Current household")).toHaveValue(fixture.household.id);
    await expect(
      page.getByText(`Spending summary for ${fixture.household.name}`),
    ).toBeVisible();
    await expect(page.getByText("$10.00").first()).toBeVisible();

    await page.getByLabel("Current household").selectOption(secondHousehold.id);
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Current household")).toHaveValue(secondHousehold.id);
    await expect(
      page.getByText(`Spending summary for ${secondHousehold.name}`),
    ).toBeVisible();
    await expect(page.getByText("$100.00").first()).toBeVisible();

    await page.goto("/reports?period=today");
    await expect(
      page.getByText(`${secondHousehold.name} | Invoice dates`),
    ).toBeVisible();
    await expect(page.getByText("$100.00").first()).toBeVisible();
    await expect(page.getByText("$10.00")).toHaveCount(0);
  } finally {
    await db.auditLog.deleteMany({ where: { householdId: secondHousehold.id } });
    await db.expense.deleteMany({ where: { householdId: secondHousehold.id } });
    await db.category.deleteMany({ where: { householdId: secondHousehold.id } });
    await db.membership.deleteMany({ where: { householdId: secondHousehold.id } });
    await db.household.delete({ where: { id: secondHousehold.id } });
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});

test("signup through an invite joins only the invited household after verification", async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const owner = await createE2EAccount(db);
  const inviteToken = createInviteToken();
  const invitedEmail = `invite-signup-${crypto.randomUUID()}@example.com`;
  const invite = await db.householdInvite.create({
    data: {
      householdId: owner.household.id,
      tokenHash: hashInviteToken(inviteToken),
      email: invitedEmail,
      role: "MEMBER",
      maxUses: 1,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdByUserId: owner.user.id,
    },
  });

  try {
    await page.goto(`/invite/${inviteToken}`);
    await expect(page.getByText(owner.household.name)).toBeVisible();
    await page.getByRole("link", { name: "Create account" }).click();
    await expect(page).toHaveURL(new RegExp(`/auth/signup\\?invite=${inviteToken}`));

    await page.getByLabel("Full name").fill("Invited Signup");
    await page.getByLabel("Email address").fill(invitedEmail);
    await page.getByLabel("Password", { exact: true }).fill("InvitePass123");
    await page.getByLabel("Confirm password").fill("InvitePass123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("link", { name: "Open the local verification link" }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByText(`Spending summary for ${owner.household.name}`)).toBeVisible();

    const invitedUser = await db.user.findUniqueOrThrow({ where: { email: invitedEmail } });
    const memberships = await db.membership.findMany({
      where: { userId: invitedUser.id, removedAt: null },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.householdId).toBe(owner.household.id);
    expect(memberships[0]?.role).toBe("MEMBER");
    expect((await db.householdInvite.findUniqueOrThrow({ where: { id: invite.id } })).usedCount).toBe(1);
    expect(
      await db.inviteRateLimitAttempt.count({
        where: { action: "invite_acceptance_actor_token" },
      }),
    ).toBeGreaterThan(0);
  } finally {
    const invitedUser = await db.user.findUnique({ where: { email: invitedEmail } });
    if (invitedUser) {
      await db.auditLog.deleteMany({ where: { userId: invitedUser.id } });
      await db.session.deleteMany({ where: { userId: invitedUser.id } });
      await db.membership.deleteMany({ where: { userId: invitedUser.id } });
      await db.user.delete({ where: { id: invitedUser.id } });
    }
    await db.pendingSignup.deleteMany({ where: { email: invitedEmail } });
    await db.householdInvite.deleteMany({ where: { id: invite.id } });
    await cleanupE2EAccount(db, owner);
    await db.$disconnect();
  }
});

test("invite creation and acceptance endpoints return 429 after their limits", async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createE2EAccount(db);
  const startedAt = new Date();
  const invalidToken = createInviteToken();

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

    for (let index = 0; index < 10; index += 1) {
      const response = await page.request.post("/api/household/invites", {
        headers: { "x-csrf-token": csrfToken! },
        data: { role: "VIEWER", expiresInDays: 1, maxUses: 1 },
      });
      expect(response.status()).toBe(201);
    }
    expect(
      (
        await page.request.post("/api/household/invites", {
          headers: { "x-csrf-token": csrfToken! },
          data: { role: "VIEWER", expiresInDays: 1, maxUses: 1 },
        })
      ).status(),
    ).toBe(429);

    for (let index = 0; index < 8; index += 1) {
      expect(
        (
          await page.request.post(`/api/invites/${invalidToken}`, {
            headers: { "x-csrf-token": csrfToken! },
          })
        ).status(),
      ).toBe(400);
    }
    expect(
      (
        await page.request.post(`/api/invites/${invalidToken}`, {
          headers: { "x-csrf-token": csrfToken! },
        })
      ).status(),
    ).toBe(429);
  } finally {
    await db.inviteRateLimitAttempt.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});

test("removed signed-in users see no-household page and can accept a new invite", async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const removedUser = await createE2EAccount(db);
  const inviter = await createE2EAccount(db);
  const inviteToken = createInviteToken();
  const invite = await db.householdInvite.create({
    data: {
      householdId: inviter.household.id,
      tokenHash: hashInviteToken(inviteToken),
      email: removedUser.email,
      role: "MEMBER",
      maxUses: 1,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdByUserId: inviter.user.id,
    },
  });

  try {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(removedUser.email);
    await page.getByLabel("Password").fill(removedUser.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await db.membership.updateMany({
      where: { userId: removedUser.user.id, householdId: removedUser.household.id },
      data: { removedAt: new Date() },
    });

    await page.goto("/dashboard");
    await page.waitForURL("**/no-household");
    await expect(page.getByRole("heading", { name: "No household access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();

    await page.goto("/auth/login");
    await expect(page).toHaveURL(/\/no-household$/);

    await page.goto(`/invite/${inviteToken}`);
    await page.getByRole("button", { name: "Join household" }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByText(`Spending summary for ${inviter.household.name}`)).toBeVisible();
    expect(
      await db.membership.count({
        where: {
          userId: removedUser.user.id,
          householdId: inviter.household.id,
          role: "MEMBER",
          removedAt: null,
        },
      }),
    ).toBe(1);
  } finally {
    await db.householdInvite.deleteMany({ where: { id: invite.id } });
    await cleanupE2EAccount(db, inviter);
    await cleanupE2EAccount(db, removedUser);
    await db.$disconnect();
  }
});

test("member role changes require confirmation before the PATCH is sent", async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createE2EAccount(db);
  const member = await db.user.create({
    data: {
      name: "Role Confirm Member",
      email: `role-confirm-${crypto.randomUUID()}@example.com`,
      passwordHash: await hashPassword("RoleConfirm123"),
    },
  });
  const membership = await db.membership.create({
    data: { userId: member.id, householdId: fixture.household.id, role: "MEMBER" },
  });

  try {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/household");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Change Role Confirm Member's role");
      await dialog.dismiss();
    });
    const roleSelect = page.getByLabel("Role for Role Confirm Member").last();
    await roleSelect.selectOption("ADMIN");
    expect(
      (await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).role,
    ).toBe("MEMBER");

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await roleSelect.selectOption("VIEWER");
    await expect
      .poll(async () =>
        (await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).role,
      )
      .toBe("VIEWER");
  } finally {
    await db.auditLog.deleteMany({ where: { userId: member.id } });
    await db.membership.deleteMany({ where: { userId: member.id } });
    await db.user.deleteMany({ where: { id: member.id } });
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});

test("household management remains usable on mobile @mobile", async ({ page }) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const fixture = await createE2EAccount(db);

  try {
    await page.goto("/auth/login");
    await page.getByLabel("Email address").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await page.getByRole("link", { name: "Household" }).last().click();
    await page.waitForURL("**/household");
    await expect(page.getByRole("heading", { name: fixture.household.name })).toBeVisible();
    const roleSummary = page.getByText("Your role").locator("..");
    await expect(roleSummary).toBeVisible();
    await expect(roleSummary.getByText("OWNER", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByText(fixture.email).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite member" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invite link" })).toBeVisible();
  } finally {
    await cleanupE2EAccount(db, fixture);
    await db.$disconnect();
  }
});

test("expense and category HTTP routes enforce VIEWER, MEMBER, and ADMIN roles", async ({
  browser,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const owner = await createE2EAccount(db);
  const password = "RoleRoutePass123";
  const passwordHash = await hashPassword(password);
  const extraUsers = await Promise.all(
    (["ADMIN", "MEMBER", "VIEWER"] as const).map((role) =>
      db.user.create({
        data: {
          name: `${role} Route`,
          email: `${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
          passwordHash,
          memberships: {
            create: { householdId: owner.household.id, role },
          },
        },
      }),
    ),
  );
  const [admin, member, viewer] = extraUsers;
  const category = await db.category.create({
    data: { householdId: owner.household.id, name: `Role routes ${crypto.randomUUID()}` },
  });
  const [ownerExpense, memberExpense] = await Promise.all([
    db.expense.create({
      data: {
        userId: owner.user.id,
        householdId: owner.household.id,
        categoryId: category.id,
        invoiceNumber: "OWNER-ROUTE",
        invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
        amount: 10,
        filePath: "uploads/owner-route.pdf",
      },
    }),
    db.expense.create({
      data: {
        userId: member!.id,
        householdId: owner.household.id,
        categoryId: category.id,
        invoiceNumber: "MEMBER-ROUTE",
        invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
        amount: 20,
        filePath: "uploads/member-route.pdf",
      },
    }),
  ]);

  async function authenticatedContext(email: string) {
    const context = await browser.newContext({ baseURL: "http://localhost:3001" });
    const rolePage = await context.newPage();
    await rolePage.goto("/auth/login");
    await rolePage.getByLabel("Email address").fill(email);
    await rolePage.getByLabel("Password").fill(password);
    await rolePage.getByRole("button", { name: "Sign in" }).click();
    await rolePage.waitForURL("**/dashboard");
    const csrf = (await context.cookies()).find((cookie) => cookie.name === "mfe_csrf")?.value;
    expect(csrf).toBeTruthy();
    return { context, rolePage, csrf: csrf! };
  }

  try {
    const viewerSession = await authenticatedContext(viewer!.email);
    expect(
      (
        await viewerSession.context.request.post("/api/expenses/extract", {
          headers: { "x-csrf-token": viewerSession.csrf },
          multipart: {},
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await viewerSession.context.request.patch(`/api/expenses/${ownerExpense.id}`, {
          headers: { "x-csrf-token": viewerSession.csrf },
          data: {
            categoryId: category.id,
            invoiceNumber: "VIEWER-FORBIDDEN",
            invoiceDate: "2026-06-01",
            amount: 10,
          },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await viewerSession.context.request.post("/api/categories", {
          headers: { "x-csrf-token": viewerSession.csrf },
          data: { name: "Viewer forbidden" },
        })
      ).status(),
    ).toBe(403);
    expect((await viewerSession.context.request.get("/reports")).status()).toBe(200);
    await viewerSession.context.close();

    const memberSession = await authenticatedContext(member!.email);
    expect(
      (
        await memberSession.context.request.patch(`/api/expenses/${memberExpense.id}`, {
          headers: { "x-csrf-token": memberSession.csrf },
          data: {
            categoryId: category.id,
            invoiceNumber: "MEMBER-OWN-UPDATED",
            invoiceDate: "2026-06-01",
            amount: 21,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await memberSession.context.request.patch(`/api/expenses/${ownerExpense.id}`, {
          headers: { "x-csrf-token": memberSession.csrf },
          data: {
            categoryId: category.id,
            invoiceNumber: "MEMBER-FORBIDDEN",
            invoiceDate: "2026-06-01",
            amount: 11,
          },
        })
      ).status(),
    ).toBe(403);
    await memberSession.context.close();

    const adminSession = await authenticatedContext(admin!.email);
    expect(
      (
        await adminSession.context.request.patch(`/api/expenses/${ownerExpense.id}`, {
          headers: { "x-csrf-token": adminSession.csrf },
          data: {
            categoryId: category.id,
            invoiceNumber: "ADMIN-UPDATED",
            invoiceDate: "2026-06-01",
            amount: 12,
          },
        })
      ).status(),
    ).toBe(200);
    await adminSession.context.close();
  } finally {
    await db.session.deleteMany({ where: { userId: { in: extraUsers.map((user) => user.id) } } });
    await db.auditLog.deleteMany({ where: { userId: { in: extraUsers.map((user) => user.id) } } });
    await cleanupE2EAccount(db, owner);
    await db.user.deleteMany({ where: { id: { in: extraUsers.map((user) => user.id) } } });
    await db.$disconnect();
  }
});
