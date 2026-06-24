# Testing

This project has two kinds of automated tests:

- **Pure unit tests** — no database. They run with the bare `node --test` runner
  (parsing, OCR engines/ensemble, validation, permissions matrix, the OCR internal
  guards, etc.).
- **DB-backed integration tests** — `tests/*.integration.test.ts`. They open a real
  Prisma connection and exercise persistence, household scoping, and access rules.
  Each integration module calls `assertSafeTestDatabase()` at load time, so it
  **throws unless a safe test database is configured**. This is intentional —
  tests fail closed rather than risk touching a real database.

Because `npm test` runs the whole suite (including the integration modules), it
also needs a test database. Set one up once with the workflow below.

## Test database safety guard

`tests/helpers/test-database.ts` refuses to run DB-backed tests unless:

- `TEST_DATABASE_URL` and `DATABASE_URL` are both set and **byte-for-byte
  identical** (including the `?schema=public` suffix),
- the URL is a PostgreSQL URL,
- the database name clearly identifies a **test** database (e.g. ends in `_test`)
  or uses a disposable, test-marked schema, and
- the name does **not** look like a production database (`live`/`prod`/`production`).

This makes it effectively impossible to point the integration tests at the dev or
prod database by accident.

## One-time setup

1. **Get a disposable local Postgres.** Use whichever you have:

   - **Existing local Postgres service** (what this repo is developed against):
     no extra steps — the setup script creates the test database for you.
   - **Docker (standalone, not the app's `docker-compose.yml`):**

     ```bash
     docker run --name mfe-test-db -e POSTGRES_PASSWORD=test_password \
       -e POSTGRES_USER=test_user -e POSTGRES_DB=myfamilyexpenses_test \
       -p 5432:5432 -d postgres:17
     ```

     > The app's `docker-compose.yml` is for running the real app and deliberately
     > does **not** expose Postgres on the host. Keep the throwaway test database
     > separate from it.

2. **Create `.env.test`** from the template and point it at that throwaway database:

   ```bash
   cp .env.test.example .env.test
   ```

   Edit the credentials/host to match your local Postgres. Keep `DATABASE_URL` and
   `TEST_DATABASE_URL` **identical** and keep the `_test` database name. `.env.test`
   is gitignored — never put real credentials in it.

3. **Provision the schema** (creates the database if missing, applies all
   migrations):

   ```bash
   npm run test:db:setup
   ```

   This loads `.env.test`, validates the safety guard, and runs
   `prisma migrate deploy` against the test database only. It never touches the dev
   or prod database.

## Running tests

| Command | What it runs |
| --- | --- |
| `npm test` | Full suite. Needs `.env.test` (loaded via `--env-file-if-exists`). Without it the DB-backed modules throw on load. |
| `npm run test:db` | Only the DB-backed integration tests (`tests/*.integration.test.ts`) — Phase B/C, OCR learning, reporting, password-reset routes. Requires `.env.test`. |
| `npm run test:ocr` | OCR verification slice: `ocr-learning.integration`, `ocr-internal-guards`, and the `permissions` matrix. |
| `npm run test:repeat-password-reset` | The password-reset DB + email tests. |
| `npm run test:e2e` | Playwright end-to-end. When `TEST_DATABASE_URL` is set, the dev server it launches uses it as `DATABASE_URL`. |

### Tearing down / resetting

```bash
npm run test:db:teardown   # drops the test database (WITH FORCE)
npm run test:db:setup      # recreates + re-migrates a clean one
```

## What the OCR / Phase D.6 verification covers

These already-present tests verify the OCR-intelligence invariants — Phase D.6 is
about running them against a real database, not adding new ones:

- **Owner/admin-only access to `/ocr-learning`** and member/viewer blocked —
  `tests/permissions.test.ts` (`canViewOcrLearning`), enforced in
  `app/api/ocr-learning/summary/route.ts`.
- **Household scoping** of learning insights and feedback —
  `tests/ocr-learning.integration.test.ts`, `tests/phase-b.integration.test.ts`,
  `tests/phase-c.integration.test.ts`.
- **No raw OCR text / blocks / card digits leak** into durable rows —
  `tests/phase-c.integration.test.ts` (asserts the persisted feedback row never
  contains the raw card number) and `tests/ocr-internal-guards.test.ts`.
- **DB drafts/recommendations are never live parser rules** — the import-absence
  checks in `tests/ocr-internal-guards.test.ts` guarantee the live parsing path
  cannot import the learning/feedback/draft modules.
