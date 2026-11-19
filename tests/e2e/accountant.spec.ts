import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "../../lib/auth/password";
import { getUploadRoot } from "../../lib/storage";
import { assertSafeTestDatabase } from "../helpers/test-database";
import { money } from "../helpers/expense-money";

type Message = { ID: string; Subject: string; To: { Address: string }[] };
const mailboxUrl = process.env.TEST_MAILPIT_URL;
const password = "AccountantFixture2026";

async function findMailLink(email: string, subject: string, pathname: string, origin: string) {
  let link: string | undefined;
  await expect.poll(async () => {
    const list = await fetch(new URL("/api/v1/messages", mailboxUrl)).then((response) => response.json()) as { messages: Message[] };
    const message = list.messages.find((item) =>
      item.Subject.includes(subject) && item.To.some(({ Address }) => Address === email));
    if (!message) return undefined;
    const full = await fetch(new URL(`/api/v1/message/${message.ID}`, mailboxUrl))
      .then((response) => response.json()) as { Text: string };
    link = full.Text.split(/\s+/).find((candidate) => candidate.startsWith(origin + pathname));
    return link;
  }).toBeTruthy();
  if (!link) throw new Error("Expected a link in the synthetic mailbox.");
  return link;
}

async function signIn(page: Page, email: string, credential = password) {
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(credential);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("accountant email, verified signup, two clients, filtered downloads, and revocation", async ({ page, browser, baseURL }) => {
  test.skip(!mailboxUrl || !baseURL, "Start a disposable SMTP mailbox to run this test.");
  test.setTimeout(90_000);
  const db = new PrismaClient({ datasourceUrl: assertSafeTestDatabase() });
  const origin = new URL(baseURL!).origin;
  const suffix = crypto.randomUUID();
  const accountantEmail = `accountant-${suffix}@example.com`;
  const owner = await db.user.create({
    data: { name: "Client owner", email: `owner-${suffix}@example.com`, passwordHash: await hashPassword(password) },
  });
  const workspaces = [];
  const uploadRoot = getUploadRoot();
  const files = [];
  const accountantContext = await browser.newContext({ baseURL });

  try {
    await mkdir(uploadRoot, { recursive: true });
    for (const label of ["Alpha", "Beta"]) {
      const client = await db.household.create({ data: { name: `${label} client ${suffix}` } });
      workspaces.push(client);
      await db.membership.create({ data: { userId: owner.id, householdId: client.id, role: "OWNER" } });
      const category = await db.category.create({ data: { householdId: client.id, name: "Supplies" } });
      const file = `${label}-${suffix}.png`;
      const absolutePath = path.join(uploadRoot, file);
      files.push(absolutePath);
      await writeFile(absolutePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGkQAAAAASUVORK5CYII=", "base64"));
      await db.expense.create({
        data: {
          householdId: client.id,
          categoryId: category.id,
          userId: owner.id,
          paidByUserId: owner.id,
          invoiceNumber: `${label}-invoice`,
          vendor: `${label} market`,
          invoiceDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
          filePath: `uploads/${file}`,
          ...money(20),
        },
      });
    }
    const [alpha, beta] = workspaces;
    await page.goto("/auth/login");
    await signIn(page, owner.email);
    await page.waitForURL("**/dashboard");

    async function sendInvite(client: typeof alpha) {
      await page.getByRole("combobox", { name: /Current household/ }).selectOption(client.id);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("combobox", { name: /Current household/ })).toHaveValue(client.id);
      await page.goto("/household");
      await page.getByLabel("Accountant email").fill(accountantEmail);
      await page.getByRole("button", { name: "Send invitation" }).click();
      await expect(page.getByText(`Invitation sent to ${accountantEmail}.`)).toBeVisible();
    }

    await sendInvite(alpha);
    const firstInvite = await findMailLink(accountantEmail, "invited as an accountant", "/invite/", origin);
    const signup = await accountantContext.newPage();
    await signup.goto(firstInvite);
    await signup.getByRole("link", { name: "Create accountant account" }).click();
    await signup.getByLabel("Full name").fill("Test Accountant");
    await signup.getByLabel("Email address").fill(accountantEmail);
    await signup.getByLabel("Password", { exact: true }).fill(password);
    await signup.getByLabel("Confirm password").fill(password);
    await signup.getByRole("button", { name: "Create account" }).click();
    await expect(signup.getByText(/Check your email for a verification link/)).toBeVisible();

    const verification = await findMailLink(accountantEmail, "Verify your", "/api/auth/signup/verify", origin);
    await signup.goto(verification);
    await expect(signup.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    expect(await db.user.findUnique({ where: { email: accountantEmail } })).toBeNull();
    await signup.getByRole("button", { name: "Verify and accept invitation" }).click();
    await expect(signup).toHaveURL(`${origin}/reports/${alpha.id}`);
    await expect(signup.getByText("Alpha-invoice", { exact: true })).toBeVisible();
    const accountant = await db.user.findUniqueOrThrow({ where: { email: accountantEmail } });
    expect(accountant.emailVerifiedAt).not.toBeNull();

    // Exercise the path for a legacy account whose address has not been verified.
    await db.user.update({ where: { id: accountant.id }, data: { emailVerifiedAt: null } });
    await sendInvite(beta);
    const secondInvite = await findMailLink(accountantEmail, "invited as an accountant", "/invite/", origin);
    expect(secondInvite).not.toEqual(firstInvite);
    const returningContext = await browser.newContext({ baseURL });
    try {
      const returning = await returningContext.newPage();
      await returning.goto(secondInvite);
      await returning.getByRole("link", { name: "Sign in" }).click();
      await signIn(returning, accountantEmail);
      await expect(returning.getByRole("button", { name: "Accept accountant invitation" })).toBeVisible();
      expect(await db.membership.count({ where: { userId: accountant.id, removedAt: null } })).toBe(1);
      await returning.getByRole("button", { name: "Accept accountant invitation" }).click();
      await returning.getByRole("button", { name: "Sign out and reset password" }).click();
      await expect(returning).toHaveURL(/\/auth\/forgot-password$/);
      await returning.getByLabel("Email address").fill(accountantEmail);
      await returning.getByRole("button", { name: "Send reset link" }).click();
      const reset = await findMailLink(accountantEmail, "Reset your", "/auth/reset-password", origin);
      await returning.goto(reset);
      const updatedPassword = "AccountantReplacement2026";
      await returning.getByLabel("New password", { exact: true }).fill(updatedPassword);
      await returning.getByLabel("Confirm password").fill(updatedPassword);
      await returning.getByRole("button", { name: "Update password" }).click();
      await expect(returning).toHaveURL(/\/auth\/login\?status=password_reset$/);
      await returning.goto(secondInvite);
      await returning.getByRole("link", { name: "Sign in" }).click();
      await signIn(returning, accountantEmail, updatedPassword);
      await returning.getByRole("button", { name: "Accept accountant invitation" }).click();
      await expect(returning).toHaveURL(`${origin}/reports/${beta.id}`);
      await returning.goto("/household");
      await expect(returning).toHaveURL(`${origin}/reports/${beta.id}`);
      await expect(returning.getByText(owner.email)).toHaveCount(0);
      await returning.getByRole("link", { name: "Clients" }).click();
      await expect(returning.getByRole("heading", { name: "Clients" })).toBeVisible();
      await expect(returning.getByRole("heading", { name: alpha.name })).toBeVisible();
      await expect(returning.getByRole("heading", { name: beta.name })).toBeVisible();

      const alphaTab = await returningContext.newPage();
      await alphaTab.goto(`/reports/${alpha.id}`);
      await alphaTab.getByLabel("Report period").selectOption("custom");
      await expect(alphaTab.getByLabel("From", { exact: true })).toBeVisible();
      await alphaTab.getByLabel("Report period").selectOption("month");
      await alphaTab.getByLabel("Vendor", { exact: true }).fill("Alpha");
      await alphaTab.getByLabel("Sort expenses").selectOption("amount-desc");
      await alphaTab.getByRole("button", { name: "Run report" }).click();
      await expect(alphaTab).toHaveURL(/vendor=Alpha/);
      const exportButton = alphaTab.getByRole("link", { name: "CSV", exact: true });
      const exportLink = await exportButton.getAttribute("href");
      expect(await exportButton.getAttribute("download")).not.toBeNull();
      expect(exportLink).toContain(`/api/reports/${alpha.id}/export`);
      const exportQuery = new URL(exportLink!, origin).searchParams;
      expect(exportQuery.get("period")).toBe("custom");
      expect(exportQuery.get("fromDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(exportQuery.get("toDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(await db.auditLog.count({ where: { userId: accountant.id, action: "reports.export" } })).toBe(0);
      const csv = await alphaTab.request.get(exportLink!);
      expect(csv.ok()).toBeTruthy();
      expect(await csv.text()).toContain("Alpha-invoice");
      expect(await csv.text()).not.toContain("Beta-invoice");

      const fileLink = await alphaTab.getByRole("link", { name: "Download", exact: true }).getAttribute("href");
      expect((await alphaTab.request.get(fileLink!)).ok()).toBeTruthy();
      await db.membership.update({
        where: { userId_householdId: { userId: accountant.id, householdId: alpha.id } },
        data: { removedAt: new Date() },
      });
      expect((await alphaTab.request.get(exportLink!)).status()).toBe(404);
      expect((await alphaTab.request.get(fileLink!)).ok()).toBeFalsy();
      await returning.setViewportSize({ width: 390, height: 844 });
      await returning.goto(`/reports/${beta.id}`);
      await expect(returning.getByText("Beta-invoice", { exact: true })).toBeVisible();
      expect(await returning.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    } finally {
      await returningContext.close();
    }
  } finally {
    await accountantContext.close();
    const ids = workspaces.map(({ id }) => id);
    await db.expense.deleteMany({ where: { householdId: { in: ids } } });
    await db.household.deleteMany({ where: { id: { in: ids } } });
    await db.pendingSignup.deleteMany({ where: { email: accountantEmail } });
    await db.user.deleteMany({ where: { email: { in: [owner.email, accountantEmail] } } });
    await Promise.all(files.map((file) => unlink(file).catch(() => undefined)));
    await db.$disconnect();
  }
});
