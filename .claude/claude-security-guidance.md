# MyFamilyExpenses security rules

Project rules for the security-guidance plugin. Shared rules live in
~/.claude/claude-security-guidance.md. Source: docs/architecture.md
(business rules in section 3).

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
- The OCR worker is called by the web app only; it should not be reachable
  from the internet, and it must not log extracted text or amounts.
- Expenses and invoices are personal financial data: no real ones in
  fixtures, tests, logs, screenshots or outside services. Made-up data only.
