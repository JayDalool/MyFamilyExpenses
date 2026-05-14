# Pre-deployment Verification Checklist

Run this manually before and after deploying to the Ubuntu server.

---

## Migration order (existing database with data)

```bash
# 0. Stop the running app container or service before touching migrations.

# 1. Apply migration 1 only (adds tables, nullable columns).
#    Do NOT use `migrate deploy` here — it would apply both migrations at once,
#    leaving no window to run the backfill before migration 2 makes columns NOT NULL.
npx prisma db execute \
  --file prisma/migrations/20260501000001_add_household_tables_nullable/migration.sql \
  --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260501000001_add_household_tables_nullable

# 2. Run backfill (creates households, remaps expenses and category IDs)
npx tsx prisma/backfill.ts

#    Confirm the backfill reports:
#    - zero expenses with NULL household_id
#    - zero categories with NULL household_id
#    - zero cross-household category references
#    - zero expenses missing a matching membership

# 3. Apply migration 2 (makes household_id NOT NULL, adds tenant constraints)
npx prisma migrate deploy

# 4. Start the app again only after migration 2 succeeds.
```

**Fresh database (no existing data):**
```bash
npx prisma migrate deploy    # runs both migrations
SEED_USER_PASSWORD=... npx tsx prisma/seed.ts
```

---

## 1. Tenant Isolation

- [ ] Log in as User A (OWNER)
- [ ] Confirm User A has a household (`SELECT * FROM households;`)
- [ ] Create a category "Cat-A" and an expense as User A; log out
- [ ] Log in as User B (separate account, separate household)
- [ ] Confirm User B sees **zero** expenses on `/dashboard`
- [ ] Confirm User B sees **zero** categories from `GET /api/categories`
- [ ] Confirm `GET /expenses/<user-a-expense-id>` returns 404 for User B
- [ ] Confirm `GET /api/expenses/<id>/file` returns 404 for User B

## 2. Household Role Enforcement

- [ ] Log in as a MEMBER-role user
- [ ] Confirm `/categories` redirects to `/dashboard`
- [ ] Confirm `POST /api/categories` returns 403
- [ ] Confirm the Categories nav link is **not visible** for MEMBER users

- [ ] Log in as an OWNER-role user
- [ ] Confirm `/categories` loads and category creation works
- [ ] Confirm `POST /api/categories` returns 201
- [ ] Confirm the Categories nav link **is visible** for OWNER users

## 3. DB-Level Tenant Constraint: Cross-Household Category

- [ ] In the DB, manually try to insert an expense with a `category_id` from a different household than `household_id`
- [ ] Confirm the insert fails with a foreign key violation
  ```sql
  -- Should fail: category belongs to household A, but expense targets household B
  INSERT INTO expenses (id, user_id, household_id, category_id, ...)
  VALUES (gen_random_uuid(), '<user-id>', '<household-B-id>', '<household-A-category-id>', ...);
  ```

## 4. Summary / Reports Isolation

- [ ] As User A: note dashboard totals
- [ ] As User B: confirm totals are 0 (no cross-household leakage)
- [ ] As User B: add an expense; confirm only that expense shows

## 5. Login Rate Limiting

- [ ] Submit 5 failed login attempts for the same email
- [ ] Confirm the 6th attempt returns HTTP 429
- [ ] Check DB: `SELECT * FROM login_attempts ORDER BY created_at DESC LIMIT 10;`
- [ ] Clear failures manually and confirm login succeeds

## 6. Login — No-Membership Guard

- [ ] Manually create a user in the DB without any membership row
- [ ] Confirm login returns HTTP 403 with "Account setup is incomplete"
- [ ] Set `ALLOW_LOGIN_HOUSEHOLD_BOOTSTRAP=true`, restart
- [ ] Confirm that same user can now log in and a household is auto-created
- [ ] Set `ALLOW_LOGIN_HOUSEHOLD_BOOTSTRAP=false` again

## 7. Backfill — Existing Expenses Not Skipped

- [ ] Simulate a user who has a membership (from a previous login with bootstrap enabled) but with old expenses that have NULL `household_id`
- [ ] Run `npx tsx prisma/backfill.ts`
- [ ] Confirm the script reports those expenses as moved (not skipped)
- [ ] Confirm `SELECT COUNT(*) FROM expenses WHERE household_id IS NULL` returns 0

## 8. Upload Cleanup on Failure

- [ ] Submit an expense with valid file but incomplete data (e.g., blank amount)
- [ ] Confirm API returns 400
- [ ] Confirm **no orphaned file** was left in the uploads directory

- [ ] Submit a valid expense
- [ ] Confirm the file **is retained** in uploads/

## 9. Category Isolation

- [ ] As User A (OWNER): create category "Test-Cat"
- [ ] As User B: confirm "Test-Cat" does **not** appear
- [ ] As User B (OWNER): create category "Test-Cat" — should succeed (compound unique per household)

## 10. Rate Limiting — IP Header Trust

- [ ] Confirm `TRUST_PROXY_HEADERS=false` (default): `extractClientIp` returns null for all headers (run tests: `node --import tsx --test tests/rate-limit.test.ts`)
- [ ] Confirm `TRUST_PROXY_HEADERS=true`: cf-connecting-ip is preferred

## 11. Docker / Environment Safety

- [ ] `.env` is NOT committed (`git status` shows no `.env` file)
- [ ] `docker-compose.yml` no longer contains hardcoded `postgres`/`postgres` credentials
- [ ] Postgres port is NOT exposed publicly (only `expose: "5432"`, not `ports:`)
- [ ] `SESSION_SECRET` is a real 32+ char random value in production `.env`
- [ ] `OCR_PROVIDER=tesseract` (not `mock`) in production `.env`
- [ ] `SEED_USER_PASSWORD` is NOT in the running app container

## 12. Household List Endpoint

- [ ] `GET /api/households` returns the authenticated user's household(s) with role info
- [ ] A user from a different session cannot see the other user's households

---

## Commands to run after pulling this branch

```bash
pnpm install
npx prisma generate
npx prisma validate
node --import tsx --test tests/**/*.test.ts
pnpm typecheck
pnpm build
```

## Remaining known limitations

- Multi-household users always get their **oldest** household as the active context.
  A household-switcher UI/API (`POST /api/households/active`) is needed to make
  multi-household fully usable. Not required for the single-family use case.
- `ALLOW_LOGIN_HOUSEHOLD_BOOTSTRAP=true` must be set during fresh-user onboarding
  until a proper signup flow is built.
