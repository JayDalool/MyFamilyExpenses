# Accountant access

Owners and admins can invite an accountant to a family or company workspace. An accountant can read that workspace’s expenses, reports, and receipts. One email address can have access to several clients through separate memberships.

## Send an invitation

1. Open the correct workspace and go to **Household**.
2. Under **Invite accountant**, enter the accountant’s email and select **Send invitation**. The invitation is for one use and expires in seven days when sent from this form.
3. Check the status under the form. **Sent** means the mail server accepted the message. **Delivery failed** means the app could not send it. **Resend** issues a fresh link and revokes the previous unused link for that address and workspace.
4. Each person can send at most 30 accountant invitation emails a day, and one address can receive at most 5 a day; resends count. The list shows expiry in the app's time zone (`APP_TIME_ZONE`).
5. Revoke an unused invitation from the invitation list. To end an accepted accountant’s access, a workspace owner removes their membership under **Members**.

The email contains the workspace name, the role, and the invitation link. Reports and receipts are available inside the signed-in app.

## Accept and open a client

**New account.** Open the invitation, select **Create accountant account**, and enter the same email address and a password. The app sends a verification email. Open it and select **Verify and accept invitation**. The app verifies the email, consumes the invitation, and grants the Accountant membership in one database transaction.

**Existing account.** Sign in with the invited email and select **Accept accountant invitation**. An account whose email has not yet been verified can complete an email password reset, then reopen the invitation. The invitation process uses the existing account for the additional client.

**Google or Microsoft sign-in.** A Google account can accept directly, because Google confirms the email. Microsoft does not confirm the email it sends, so a Microsoft sign-in cannot accept an accountant invitation; the app sends the person to email signup instead. A password reset on an account whose email was never verified also removes any Google or Microsoft login linked to it, so a login someone else attached before the owner proved the inbox stops working.

Acceptance opens the client’s **Reports** page. Use **Clients** to open another client. Each report, expense detail, and receipt link identifies its workspace. Membership is checked again when the page, file, or export is requested.

## Reports and exports

- Filter by period, custom dates, vendor, category, paid-by member, and currency.
- Sort by invoice date or amount. PDFs, CSV, XLSX, and **ZIP with receipts** use the dates shown on the report, its filters, and its sort order.
- If the selection contains multiple currencies, choose one currency for totals and exports. Make separate exports for the other currencies.
- The ZIP contains the receipt files, PDF summary, CSV and XLSX indexes, and a README. The README lists missing files.

## Deploy

Apply the database migration with `npx prisma migrate deploy` before enabling the feature. The migration adds delivery status to household invitations. Existing email-bound, single-use accountant invitations can still be accepted by a verified account. Older accountant invitations without an email address, or with more than one use, can no longer be accepted and do not appear in either Household list; send a new invitation instead.

Set the following in each deployment’s environment. The base Compose file passes them to the app.

| Environment variable | Value |
| --- | --- |
| `APP_BASE_URL` | The URL the accountant can reach from their email. Use the deployed HTTPS address. |
| `SMTP_ENABLED` | `true` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Settings for the deployment’s mail relay. |
| `SMTP_USER`, `SMTP_PASSWORD` | Credentials for an authenticated relay. Both may be empty for a trusted relay without authentication. |
| `SMTP_FROM` | Sender address accepted by the mail relay. |

Check invitation and verification delivery on staging with synthetic mailboxes before enabling it for a client. Configure credentials separately on the Dell and on the hosted deployment. The two deployments use separate databases and receipt storage, so an accountant accepts a membership on the deployment that hosts each client.

## Test with a local mailbox

The scenario in `tests/e2e/accountant.spec.ts` uses Mailpit to read the invitation and verification emails. Point `TEST_MAILPIT_URL` at a disposable Mailpit HTTP endpoint and configure the app’s SMTP variables to use that instance. Run Playwright with a disposable database, a test uploads directory, and `APP_BASE_URL` matching the Playwright base URL. Use `npm run test:e2e -- accountant.spec.ts` to run this scenario. The test skips when the mailbox URL is absent.

## Acceptance checks

- Owner and admin can send an invitation from the active workspace. A member or accountant is denied. A stale workspace form cannot send from a different workspace.
- Accountant invitations require an email address and one use. The invite token is hashed at rest. A failed send is visible and can be retried. Revoked, expired, used, and superseded links cannot add a membership.
- Opening the verification link shows a confirmation page. Only submitting the confirmation grants access. A different email and an unverified existing account are denied.
- A new accountant sets a password and gains only the invited workspace. An existing accountant can add a second client and open both reports in different tabs.
- Stale tabs keep their own client in report URLs and expense downloads. A revoked client is denied on fresh report, export, and receipt requests. Accountant membership permits reads and exports.
- Expense JSON includes only the submitter’s public ID and name. Accountants have read-only access and the membership email directory is restricted.
- The report view and downloaded register match for dates, filters, currency, and sort. Mixed currencies require an explicit choice before totals are shown.
