# MyFamilyExpenses Architecture

## 1. Purpose

MyFamilyExpenses is a household-based expense, receipt, invoice, and reporting system.

The app is designed to support:

* Personal and family expense tracking
* Multiple households/families per user
* Invite-only household membership
* Receipt and invoice uploads
* OCR-assisted receipt/invoice recognition
* Manual user review before saving extracted data
* Category-based expense organization
* Daily, weekly, monthly, yearly, and custom reports
* Future subscription plans and usage limits

The system must stay reliable on a small self-hosted server before moving to larger infrastructure.

---

## 2. Current Server Assumptions

Current deployment target:

* Dell OptiPlex XE3 class machine
* Intel i5-8500 / i5-9600 class CPU
* 6 cores / 6 threads
* 14–16 GB RAM
* 250 GB NVMe boot/app storage
* Ubuntu Server
* Docker-based deployment
* PostgreSQL database
* Nginx Proxy Manager / Cloudflare tunnel
* Existing apps running beside MyFamilyExpenses

Expected short-term capacity:

* 150 registered users
* Small number of concurrent active users
* OCR processed asynchronously
* OCR worker concurrency starts at 1 job at a time
* Uploads limited by file size and page count
* Storage growth monitored closely

Important rule:

> The web app must never run heavy OCR directly inside a user-facing request.

OCR must run through a background job system.

---

## 3. High-Level Architecture

```text
Browser
  |
  v
Next.js Web App
  |
  |-- Auth / Sessions
  |-- Household / Membership logic
  |-- Expense CRUD
  |-- Category management
  |-- Reports
  |-- Upload API
  |
  v
PostgreSQL
  |
  |-- users
  |-- households
  |-- memberships
  |-- invitations
  |-- categories
  |-- expenses
  |-- document_files
  |-- ocr_jobs
  |-- ocr_results
  |-- audit_logs
  |-- usage_counters
  |
  v
Private File Storage
  |
  |-- receipt/invoice originals
  |-- generated previews
  |-- OCR artifacts if needed

Background OCR Worker
  |
  |-- Picks queued OCR jobs
  |-- Runs PaddleOCR / fallback OCR
  |-- Normalizes extracted fields
  |-- Calculates confidence
  |-- Flags duplicates
  |-- Saves result for user review
```

---

## 4. Core Services

### 4.1 Next.js App

Responsibilities:

* User interface
* Authentication
* Session handling
* Household switching
* Expense creation/edit/delete
* Category management
* Reports
* Receipt/invoice upload
* OCR result review UI
* Subscription-gating foundation later

The Next.js app should stay fast and lightweight.

It should not:

* Run heavy OCR inside API requests
* Block users while documents are being processed
* Trust OCR output without user confirmation
* Expose uploaded files publicly

---

### 4.2 PostgreSQL Database

PostgreSQL is the source of truth.

It stores:

* Users
* Households
* Memberships
* Invitations
* Expenses
* Categories
* Document file metadata
* OCR jobs
* OCR results
* Audit logs
* Usage counters
* Subscription state later

Tenant isolation must be enforced at the database query level using `household_id`.

Every household-owned table must include `household_id`.

---

### 4.3 Private File Storage

Receipt and invoice files must be stored outside the public web directory.

Files should be accessed only through authenticated routes.

File metadata should be stored in the database.

Required metadata:

* `id`
* `household_id`
* `uploaded_by_user_id`
* `expense_id` if linked
* `original_filename`
* `stored_filename`
* `file_path`
* `mime_type`
* `detected_type`
* `file_size`
* `sha256_hash`
* `page_count`
* `created_at`

Future storage options:

1. Local disk
2. Mounted larger drive
3. NAS
4. S3-compatible object storage

For 150 users, local disk is acceptable only if storage is monitored and backed up.

---

## 5. Multi-Household / Family Model

### 5.1 Concept

A user can belong to multiple households.

Example:

* Jay owns the “Dalool Family” household.
* Jay invites his brother, parents, or spouse.
* Jay may also belong to another household, such as “Business Expenses” or “Rental Property.”
* Each household has separate expenses, categories, reports, files, and OCR usage.

A user must not see another household’s data unless they are a member.

---

### 5.2 Household Membership

Recommended roles:

```text
OWNER
ADMIN
MEMBER
VIEWER
```

Role permissions:

| Action                   | OWNER |         ADMIN |   MEMBER | VIEWER |
| ------------------------ | ----: | ------------: | -------: | -----: |
| View dashboard           |   Yes |           Yes |      Yes |    Yes |
| View reports             |   Yes |           Yes |      Yes |    Yes |
| Add expense              |   Yes |           Yes |      Yes |     No |
| Edit own expense         |   Yes |           Yes |      Yes |     No |
| Edit any expense         |   Yes |           Yes | Optional |     No |
| Delete expense           |   Yes |           Yes | Optional |     No |
| Manage categories        |   Yes |           Yes |       No |     No |
| Invite members           |   Yes |           Yes |       No |     No |
| Remove members           |   Yes |           Yes |       No |     No |
| Change billing           |   Yes | No by default |       No |     No |
| Delete/archive household |   Yes |            No |       No |     No |

---

### 5.3 Invite-Only Access

Households should be invite-only.

A user should not be able to join a household manually by guessing an ID.

Invite flow:

```text
Owner/Admin creates invite
  |
  v
System creates invitation token
  |
  v
Invite link is generated
  |
  v
User opens link
  |
  v
If logged out: user signs up/logs in
  |
  v
User accepts invite
  |
  v
Membership is created
```

Example invite link:

```text
https://app.example.com/invite/abc123securetoken
```

Similar to Discord-style invites, but with stricter financial-data security.

Invite fields:

* `id`
* `household_id`
* `email` nullable
* `token_hash`
* `role`
* `created_by_user_id`
* `expires_at`
* `max_uses`
* `used_count`
* `revoked_at`
* `created_at`
* `accepted_at`

Security rules:

* Store only hashed invite tokens.
* Invite links expire.
* Owner/Admin can revoke invites.
* Optional email-restricted invites.
* Audit every invite created, accepted, revoked, or expired.
* Never expose household data before invite acceptance.

---

### 5.4 Active Household Selection

Because a user can belong to multiple households, the app needs an active household selector.

Rules:

* User has one active household at a time.
* Dashboard, expenses, reports, categories, uploads, and OCR all use the active household.
* The active household can be stored in:

  * session metadata, or
  * user preference, or
  * signed cookie

Required UI:

* Current household name visible in the sidebar/topbar
* Household switcher dropdown
* “Create household” button if allowed
* “Manage household” page for owners/admins

No route should infer household only from the frontend.

Backend must always verify membership.

---

## 6. Subscription-Ready Household Model

Subscriptions should be attached to the household, not only the user.

Reason:

* A household may have multiple members.
* Billing should unlock features for the whole household.
* The owner pays, members use.

Future plan examples:

| Plan     | Households | Members | OCR scans/month | Reports      | Storage |
| -------- | ---------: | ------: | --------------: | ------------ | ------- |
| Free     |          1 |       2 |              25 | Basic        | Low     |
| Basic    |          1 |       3 |             100 | Basic        | Medium  |
| Pro      |          3 |      10 |             500 | Advanced     | Higher  |
| Business |     Custom |  Custom |          Custom | Advanced/API | Custom  |

Subscription checks should eventually control:

* Number of households
* Members per household
* OCR scans per month
* Storage limit
* Advanced reports
* Export features
* Multi-household support
* Retention period
* Priority processing

Do not implement Stripe before the household, usage, and entitlement model is stable.

---

## 7. OCR Architecture

### 7.1 OCR Goals

The OCR system should support:

* Receipts
* Invoices
* Images
* PDFs
* Better recognition accuracy
* Structured extraction
* Duplicate detection
* User review before saving
* Usage tracking for future plans

OCR must be asynchronous.

---

### 7.2 OCR Providers

Recommended provider order:

```text
1. Local basic extractor
2. PaddleOCR worker
3. invoice2data templates for recurring invoices
4. Optional paid cloud OCR fallback later
```

Initial self-hosted stack:

* PaddleOCR for image/PDF text extraction
* OCRmyPDF/Tesseract as fallback where useful
* invoice2data for known recurring invoice templates

Paid cloud OCR should remain optional and only be added later for low-confidence scans or paid plans.

---

### 7.3 OCR Job Flow

```text
User uploads receipt/invoice
  |
  v
Upload API validates file signature, size, and type
  |
  v
File saved privately
  |
  v
document_files row created
  |
  v
ocr_jobs row created with status = queued
  |
  v
Background worker picks job
  |
  v
Worker runs OCR provider
  |
  v
Worker stores raw OCR result
  |
  v
Worker normalizes fields
  |
  v
Worker calculates confidence score
  |
  v
Worker checks for possible duplicates
  |
  v
ocr_results row saved
  |
  v
User reviews extracted data
  |
  v
User confirms/edits
  |
  v
Expense is created or updated
```

---

### 7.4 OCR Job Statuses

```text
uploaded
queued
processing
needs_review
completed
failed
cancelled
```

Meaning:

* `uploaded`: file is saved but OCR has not started
* `queued`: job is waiting for the worker
* `processing`: worker is currently processing
* `needs_review`: OCR finished and user must confirm/edit
* `completed`: user confirmed and linked result to expense
* `failed`: OCR failed
* `cancelled`: user/system cancelled job

---

### 7.5 OCR Concurrency

For the current server:

```text
OCR_CONCURRENCY=1
OCR_MAX_FILE_SIZE_MB=10
OCR_MAX_PAGES=3
OCR_JOB_TIMEOUT_SECONDS=120
```

Why:

* OCR is CPU-heavy.
* The server has limited CPU/RAM.
* The web app must remain responsive.
* Users can wait for OCR, but the app should not crash.

Future scaling:

```text
If CPU/RAM usage is acceptable:
  OCR_CONCURRENCY=2

If OCR demand grows:
  Move OCR worker to another machine

If accuracy/speed becomes critical:
  Add paid cloud OCR fallback for paid plans
```

---

### 7.6 OCR Result Fields

Normalized result:

```json
{
  "documentType": "receipt",
  "vendorName": "Example Store",
  "invoiceNumber": "INV-123",
  "invoiceDate": "2026-06-06",
  "dueDate": null,
  "subtotal": "100.00",
  "tax": "12.00",
  "total": "112.00",
  "currency": "CAD",
  "lineItems": [
    {
      "description": "Item name",
      "quantity": "1",
      "unitPrice": "100.00",
      "total": "100.00"
    }
  ],
  "confidence": 0.91,
  "warnings": []
}
```

Important:

> OCR output is a suggestion, not the final financial record.

The user must review and confirm before saving.

---

### 7.7 Duplicate Detection

Warn the user if the household already has a similar expense.

Duplicate signals:

* Same file hash
* Same invoice number
* Same vendor
* Same date
* Same amount
* Same category
* Similar OCR text fingerprint

Duplicate result should be a warning, not an automatic block.

---

### 7.8 OCR Usage Tracking

Track OCR usage per household.

Usage counters:

* uploads
* OCR attempts
* successful OCR scans
* failed OCR scans
* pages processed
* storage used
* paid fallback scans later

This prepares the app for subscription plans without adding billing too early.

---

## 8. Reports Architecture

Reports must be accurate before they are pretty.

Required reports:

* Today
* This week
* This month
* This year
* Custom date range
* Category breakdown
* Expense count
* Total amount
* Average expense
* Recent invoices/receipts
* Export later

All reports must:

* Use active household
* Exclude soft-deleted expenses
* Respect role permissions
* Match dashboard totals
* Use server-side database queries
* Avoid loading all records at once
* Paginate invoice/receipt lists

Report periods:

```text
daily: invoice_date = selected date
weekly: start of week to end of week
monthly: first day to last day of month
yearly: Jan 1 to Dec 31
custom: selected start/end dates
```

Dashboard should show:

* Today total
* This week total
* This month total
* This year total
* All-time total
* Recent expenses
* Current household name

---

## 9. Category Management

Categories are household-owned.

Rules:

* Categories belong to one household.
* Categories can be edited by OWNER/ADMIN.
* Categories can be disabled/archived.
* Disabled categories cannot be selected for new expenses.
* Existing expenses using disabled categories must still display correctly.
* Existing expenses can retain a disabled category while editing other fields.
* Categories with expenses should not be hard-deleted.
* Categories with no expenses may be deleted if safe.

Recommended fields:

* `id`
* `household_id`
* `name`
* `description`
* `color`
* `icon`
* `sort_order`
* `is_active`
* `archived_at`
* `created_at`
* `updated_at`

Audit events:

* category.created
* category.updated
* category.disabled
* category.enabled
* category.deleted

---

## 10. Audit Logging

Audit logs are required for trust and debugging.

Track:

* login
* logout
* signup
* household created
* household updated
* invite created
* invite accepted
* invite revoked
* member added
* member removed
* role changed
* category created/updated/disabled/deleted
* expense created/updated/deleted
* document uploaded
* OCR queued/started/completed/failed
* report exported later
* subscription changed later

Do not store:

* passwords
* raw tokens
* full secrets
* full OCR document text if sensitive
* payment card details

Audit logs should include:

* `household_id`
* `user_id`
* `action`
* `entity_type`
* `entity_id`
* `metadata`
* `ip_address` if available
* `user_agent` if available
* `created_at`

---

## 11. UI Architecture

The app should avoid generic “AI slop” UI.

Use a real design system.

Recommended UI stack:

* shadcn/ui
* Radix UI primitives
* Tailwind CSS
* Lucide icons
* React Hook Form
* Zod validation
* TanStack Table for larger tables later
* Sonner for toast notifications
* Recharts only when reports need charts

Design rules:

* Clean financial dashboard
* Strong spacing
* Consistent cards
* Clear table layout
* Clear empty states
* Clear loading states
* Clear error states
* No random gradients everywhere
* No oversized AI-style hero cards inside the app
* Use professional accounting/finance layout
* Make totals easy to read
* Make household selector always visible
* Make destructive actions confirm clearly

Core UI components to standardize:

* Button
* Input
* Select
* Dialog
* Dropdown Menu
* Tabs
* Card
* Table
* Badge
* Alert
* Toast
* Form
* Date Picker
* Pagination
* Sidebar
* Breadcrumb
* Sheet/Drawer
* Skeleton loading state

Main app layout:

```text
Sidebar
  - Dashboard
  - Expenses
  - Reports
  - Categories
  - Documents/OCR
  - Household
  - Settings

Topbar
  - Active household switcher
  - User menu
  - Notifications/status

Content
  - Page title
  - Page actions
  - Filters
  - Main content
```

---

## 12. Security Rules

Required security rules:

* Every household-owned query must filter by `household_id`.
* Every mutation must verify membership and role.
* Never trust household ID from frontend alone.
* CSRF protection on mutating requests.
* Upload file signature validation.
* File size limits.
* Private file storage.
* Authenticated file preview/download routes.
* Same-origin PDF preview only.
* Audit important actions.
* Rate-limit login, signup, upload, and OCR requests.
* No public database ports.
* No hardcoded secrets.
* No raw secrets in logs.

---

## 13. Deployment Architecture

Current deployment:

```text
Docker Compose
  |
  |-- app: Next.js app
  |-- db: PostgreSQL
  |-- future ocr-worker: Python PaddleOCR worker
```

Future docker services:

```yaml
services:
  app:
    build: .
    depends_on:
      - db

  db:
    image: postgres:17

  ocr-worker:
    build:
      context: ./workers/ocr
    depends_on:
      - db
    environment:
      OCR_CONCURRENCY: "1"
      OCR_MAX_FILE_SIZE_MB: "10"
      OCR_MAX_PAGES: "3"
```

Production rules:

* App exposed only through local port / reverse proxy
* Database exposed only on localhost if needed for admin tools
* OCR worker not exposed publicly
* Backups run daily
* File storage backed up
* Migrations applied using `prisma migrate deploy`
* Never use `prisma migrate dev` in production

---

## 14. Backup Strategy

Back up:

1. PostgreSQL database
2. Uploaded receipt/invoice files
3. Environment files
4. Docker compose files
5. Nginx/Cloudflare configuration

Minimum backup schedule:

```text
Database: daily
Uploaded files: daily or incremental
Config files: after every change
Retention: 30 daily backups minimum
```

Before every production deployment:

```text
1. Create manual DB backup
2. Pull code
3. Build image
4. Check migration status
5. Apply migrations
6. Restart app
7. Smoke test
```

---

## 15. Scaling Plan

### Current Server Safe Limits

Initial limits:

```text
OCR concurrency: 1
Max upload size: 10 MB
Max pages per document: 3
Max OCR jobs per household per day: plan-dependent later
Max report page size: 50 rows
```

### When Usage Grows

If web app is slow:

* Add app-level caching carefully
* Optimize database queries
* Add indexes
* Move OCR worker away from app server

If OCR is slow:

* Keep OCR queued
* Add a second worker only if CPU/RAM allows
* Move OCR to a dedicated machine
* Add paid cloud OCR fallback

If storage grows:

* Add 1–2 TB storage
* Move files to object storage
* Add retention policies

---

## 16. Roadmap

### Phase 1: Security and Financial Correctness

* CSRF protection
* Secure upload validation
* Soft delete expenses
* Audit log foundation
* Expense edit/delete
* Dashboard/report totals correctness

### Phase 2: Reports and Category Management

* Daily/weekly/monthly/yearly/custom reports
* Category breakdown
* Invoice/receipt list
* Category edit/disable/delete
* Dashboard all-time/year/month/week/today totals

### Phase 3: Multi-Household Foundation

* Active household selector
* Invite-only household access
* Household member management
* Role enforcement
* Household-scoped reports and OCR
* Audit household/member actions

### Phase 4: OCR v2 Foundation

* document_files table
* ocr_jobs table
* ocr_results table
* Background OCR worker
* PaddleOCR local provider
* Fallback OCR provider
* OCR result review UI
* Duplicate detection
* Confidence scoring

### Phase 5: Usage Limits and Entitlements

* usage_counters table
* plan placeholder table
* feature gates
* household limits
* OCR monthly limits
* storage limits

### Phase 6: Subscription Billing

* Stripe or other billing provider
* Checkout
* Customer portal
* Webhooks
* Subscription state
* Trial handling
* Upgrade/downgrade behavior

### Phase 7: Production Hardening

* Monitoring
* Error tracking
* Health checks
* Backup verification
* Docker hardening
* Storage expansion
* Admin tools

---

## 17. Engineering Rules

Do not build features randomly.

Every new feature must answer:

1. Is it household-scoped?
2. Does it respect role permissions?
3. Does it need audit logging?
4. Does it affect reports?
5. Does it affect billing/usage later?
6. Does it need tests?
7. Does it work for multiple households?
8. Does it keep the app fast on the current server?

No feature should be considered complete until it has:

* Database migration if needed
* Server-side validation
* Tenant isolation
* Role checks
* Tests
* Basic UI state
* Error state
* Audit log where needed
* Smoke test checklist

---

## 18. Current Priorities

Immediate next priorities:

```text
1. Fix dashboard/report totals
2. Add reports page
3. Add category edit/disable/delete
4. Review and improve household/membership model
5. Add active household switcher
6. Add invite-only household joining
7. Add OCR job/result foundation
8. Add PaddleOCR worker
9. Add usage counters
10. Add subscription plans later
```

Do not add billing before the household and usage model is stable.
