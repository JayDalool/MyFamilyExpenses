# 0001. Organizations are households with a kind

Date: 2026-10-01. Status: accepted (Jay).

## Context

MyFamilyExpenses must serve families, companies, and licensed professionals. Companies
need three kinds of people: an admin, an accountant, and employees. Before this change:

- `Household` is the tenant. Every table is scoped by `household_id`.
- Roles were OWNER, ADMIN, MEMBER, VIEWER.
- Writes were role-checked. Reads were not: any member could list every expense and
  export the full household report.

That is acceptable for a family. In a company it exposes colleagues' spending.

## Decision

- No new organization table. A household is the organization.
- Add `Household.kind` (`FAMILY` default, `COMPANY`). Existing rows become `FAMILY`.
- Add role `ACCOUNTANT`: reads all expenses, views reports, exports. Cannot create,
  edit, or delete.
- In a `COMPANY`, `MEMBER` is shown as "Employee" and sees only expenses they entered or
  paid. They get no household reports, totals, or exports. `FAMILY` behavior is unchanged.
- A signed-in user creates a company from the Household page. They become its OWNER.
  Signup is unchanged.

Rules live in `lib/auth/permissions.ts` (`expenseReadScope`, `canViewReports`,
`isReadOnlyRole`). Labels live in `lib/auth/role-labels.ts`.

## Alternatives considered

- **Separate `Organization` table above households.** Cleaner for large companies with
  several teams. Rejected for now: it changes every tenant query and the live data model
  for no current need.
- **Per-role permission table.** Rejected: five roles and one `kind` flag are enough.

## Consequences

- Migration is additive (`ALTER TYPE ... ADD VALUE`, one new column with a default).
  Rollback: the app tolerates the new column; removing the enum value needs a type rebuild,
  so do not roll back after an ACCOUNTANT row exists.
- Any new query that returns expenses must apply `expenseReadScope(auth)`. Household-wide
  aggregates (`lib/reporting.ts`) are for roles where `canViewReports(auth)` is true.

## Future considerations

Teams or departments inside a company, per-employee export for accountants, a billing
owner separate from OWNER, converting an existing family household to a company.
