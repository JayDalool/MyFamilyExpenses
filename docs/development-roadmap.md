# MyFamilyExpenses Development Roadmap

## Goal

Build a production-ready, self-hosted family expense tracker quickly, without overengineering.

The fastest safe path is:

1. ship a stable app shell and auth foundation
2. enforce the category-first expense workflow
3. add reliable upload and local storage
4. add OCR and review
5. add history, reports, dashboard, and operational hardening

## Delivery principles

- Keep changes small and vertical.
- Build one complete workflow before broadening features.
- Prefer boring, maintainable solutions over clever abstractions.
- Add tests when behavior changes.
- Keep every phase deployable.

## Suggested phase plan

### Phase 0: Project foundation

#### Objectives

- Scaffold the Next.js app and Prisma setup
- Create local development environment
- Establish design system and app shell
- Set up CI basics

#### Deliverables

- Next.js App Router app with TypeScript
- Tailwind CSS configured
- Prisma connected to PostgreSQL
- Basic route groups for auth and app areas
- ESLint, TypeScript, Prettier if desired
- `.env.example`
- Docker Compose for local development
- Seed script for initial admin user and categories

#### Acceptance criteria

- App boots locally
- Database migrations run cleanly
- Initial admin can log in after seed
- CI can run lint, typecheck, and tests

#### Test focus

- Basic smoke test for home page
- Prisma connection integration test
- Auth config unit coverage

### Phase 1: Authentication and user management

#### Objectives

- Implement secure credentials auth
- Support admin and standard roles
- Add user management screens and APIs

#### Deliverables

- Login/logout
- Session management with HTTP-only cookies
- Admin user list, create user, edit user, deactivate user
- Password change for logged-in user
- Admin reset password flow
- Optional self-service forgot/reset behind SMTP config

#### Acceptance criteria

- Admin can create users
- User can sign in and sign out
- Route protection works
- Non-admin cannot access admin screens or admin APIs

#### Test focus

- Unit tests for password hashing and session token handling
- Integration tests for login/logout/reset flows
- Authorization tests for admin-only routes

### Phase 2: Category management

#### Objectives

- Deliver the category system before expense capture
- Give admins full category control

#### Deliverables

- Categories table and seed data
- Admin category list
- Add/edit/disable/reorder category APIs and UI
- Active categories endpoint for expense wizard

#### Acceptance criteria

- Admin can create, edit, disable, and reorder categories
- Disabled categories do not appear in new expense selection
- Historical expenses can still display disabled categories later

#### Test focus

- Validation tests for unique category names
- Integration tests for reorder and disable behavior
- Permission tests for admin-only access

### Phase 3: Category-first expense draft workflow

#### Objectives

- Enforce the business workflow before OCR exists
- Lock in the state machine for new expense capture

#### Deliverables

- Select category screen
- `expense_drafts` table and service layer
- `POST /api/expense-drafts`
- Draft ownership and expiry handling
- Navigation from category selection to upload step

#### Acceptance criteria

- Upload page cannot be reached without a valid draft
- Draft cannot be created with disabled category
- Draft belongs to exactly one user

#### Test focus

- State transition tests for drafts
- Authorization tests for draft ownership
- E2E test for category selection gating upload

### Phase 4: File upload and local invoice storage

#### Objectives

- Support image and PDF upload
- Store invoice files safely on disk

#### Deliverables

- Upload API for image/PDF files
- Temporary draft storage path
- Final expense storage path strategy
- Secure preview/download route
- File validation rules

#### Acceptance criteria

- User can upload supported file types
- Invalid or oversized files are rejected cleanly
- Files are stored outside the public web root
- Another user cannot access someone else's file

#### Test focus

- Upload validation tests
- Integration tests for storage path creation
- Auth tests for file streaming endpoint

### Phase 5: OCR worker and review screen

#### Objectives

- Extract invoice number, date, and total locally
- Allow manual review before save

#### Deliverables

- OCR worker service
- `ocr_jobs` and `ocr_extractions`
- OCR provider contract
- Draft status polling
- Review extracted data screen
- `POST /api/expenses` final save from draft

#### Acceptance criteria

- OCR runs after upload
- Review screen shows extracted values
- User can edit values before save
- Save creates a final expense and closes the draft
- OCR failure still allows manual save after review

#### Test focus

- Unit tests for extraction heuristics
- Integration tests for draft -> OCR -> save flow
- E2E test for image/PDF upload and save

### Phase 6: Expense history, search, and preview

#### Objectives

- Make saved expenses easy to browse and trust

#### Deliverables

- Expense history page
- Search/filter/sort/pagination APIs
- Expense detail view
- Invoice preview
- Soft delete

#### Acceptance criteria

- User can search by invoice number and date range
- Admin can filter by user
- Sorting and pagination behave consistently
- Deleted records no longer appear in standard listings

#### Test focus

- Query filter integration tests
- Pagination/sorting tests
- Soft delete behavior tests

### Phase 7: Reports and dashboard

#### Objectives

- Provide immediate value after data exists

#### Deliverables

- Dashboard cards
- Recent invoices list
- Reports summary endpoint
- Reports by category
- Reports by user
- Monthly totals

#### Acceptance criteria

- Totals match the database
- User sees only own numbers
- Admin can see all-user totals

#### Test focus

- Aggregate query tests
- Permission tests for report scopes
- Snapshot tests for dashboard data adapters if useful

### Phase 8: Security hardening and deployment readiness

#### Objectives

- Make the app safe to self-host
- Prepare backup and restore routines

#### Deliverables

- Rate limiting
- Audit logging
- Secure headers
- Password reset hardening
- Backup scripts
- Restore runbook
- Production Docker images
- Reverse proxy config

#### Acceptance criteria

- Production deployment works on a personal server
- Backups can be produced and restored
- Login and reset endpoints are rate limited
- Security headers are present

#### Test focus

- Integration tests for audit log emission
- Smoke tests against production build
- Manual restore drill

## Suggested implementation order by week

This is a realistic solo-developer order, not a strict schedule:

| Week | Focus |
| --- | --- |
| 1 | Phase 0 and Phase 1 |
| 2 | Phase 2 and Phase 3 |
| 3 | Phase 4 |
| 4 | Phase 5 |
| 5 | Phase 6 and Phase 7 |
| 6 | Phase 8, polish, deployment, restore drill |

If time is tighter, compress by shipping in this order:

1. auth
2. categories
3. draft gating
4. upload/storage
5. OCR review/save
6. history
7. dashboard/reports
8. hardening

## Definition of done per feature

A feature is not done until:

- business rule is implemented in service layer
- UI path is complete
- validation errors are user-friendly
- lint passes
- typecheck passes
- tests pass
- audit logging is added if the feature changes sensitive data
- docs or environment variables are updated if needed

## Testing strategy

### Unit tests

Use for:

- validation schemas
- auth helpers
- extraction heuristics
- date and money parsing
- permission guards

### Integration tests

Use for:

- route handlers
- Prisma repositories
- session lifecycle
- draft workflow transitions
- report aggregation

### End-to-end tests

Use Playwright for:

- login flow
- create category as admin
- create expense as user
- upload invoice and review OCR result
- search expense history
- view reports

### Manual QA checklist

Run on desktop and mobile widths:

- Login is usable on phone
- Category selection is clear
- Camera/upload buttons are large and easy to tap
- OCR review form is readable on small screens
- History filters fit on mobile
- Dashboard cards load quickly

## Risk register

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| OCR quality varies by invoice layout | User trust can drop quickly | Keep manual review mandatory before save |
| Self-hosted email may not be configured | Forgot-password can stall | Support admin reset first, SMTP reset second |
| File handling bugs can create security issues | Uploaded files are a common attack surface | Validate signature, MIME, size, storage path, and access control |
| Scope creep into finance app features | Slows MVP | Keep MVP to expense tracking, not budgeting or accounting |
| Overcomplicated architecture | Harder for a solo developer to maintain | Keep one app, one DB, one OCR worker |

## Recommended MVP cut line

If you need to move even faster, cut to this exact MVP:

- auth with admin/user roles
- categories
- category-first draft workflow
- upload image/PDF
- OCR extract three fields
- review and save
- history list with date/category filters
- dashboard totals for today and month
- simple reports summary by range/category

Delay these until after first real usage:

- self-service email reset
- CSV export
- advanced charts
- multi-currency
- OCR retries UI
- vendor-specific extraction tuning
