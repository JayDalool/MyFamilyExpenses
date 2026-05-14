import { expect, test } from "@playwright/test";

test("signup page submits and shows the verification success state", async ({ page }) => {
  await page.route("**/api/auth/signup", async (route) => {
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
