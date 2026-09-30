# MyFamilyExpenses security rules

Project rules for the security-guidance plugin. Shared rules live in
~/.claude/claude-security-guidance.md. Sources: docs/architecture.md
(business rules in section 3) and docs/deployment-self-hosted.md.

- Roles are ADMIN and USER. A USER sees and changes only their own expenses,
  drafts and invoice files; only an ADMIN sees across users. Check this on
  the server for every object, not only on the route.
- Invoice files are uploaded only through `POST /api/expense-drafts/:id/upload`
  for a valid draft owned by the current user; never direct upload to
  `/api/expenses`. Check type and size and store under a generated name.
- Invoice files are never served directly from disk paths; only through an
  authorized route that checks ownership.
- Passwords with Argon2id; sessions are DB-backed.
- Deleting an expense is a soft delete.
- The OCR worker is internal-only (never exposed through Caddy); it takes
  jobs from the Postgres queue and must not log extracted text or amounts.
- Expenses and invoices are personal financial data: no real ones in
  fixtures, tests, logs, screenshots or outside services. Made-up data only.
