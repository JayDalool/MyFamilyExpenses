# MyFamilyExpenses

A family expense tracker web application where multiple family members can log in, scan invoices, categorize expenses, and browse or report expenses by date range.

## Core idea

Each family member can:
- have their own user account
- scan/upload invoice images
- choose an expense category before scanning
- let AI extract invoice number, invoice date, vendor, and total amount
- browse past invoices by invoice number or date
- view expense totals within selected date ranges

## Planned categories
- Groceries
- Restaurant
- Travel
- Education
- Utilities
- Medical
- Shopping
- Transportation
- Entertainment
- Other

## High-level features
- Family user management
- Expense category management
- Invoice upload and scan
- OCR/data extraction
- Expense records
- Invoice search
- Date range reporting
- Dashboard summaries
- Role-based access

## Planned stack
- Frontend: Next.js
- Backend: Next.js API routes or NestJS
- Database: PostgreSQL
- ORM: Prisma
- Auth: NextAuth or Clerk
- Storage: Local for dev, S3-compatible later
- OCR/AI extraction: pluggable service layer

## Development approach
- Claude Code: implementation
- Codex: review, testing, validation
- GitHub Actions: source of truth for CI
