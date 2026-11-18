"use client";

import { useState } from "react";
import { Button, ButtonLink, Input, Select } from "@/components/ui";
import type { ReportFilters as Filters, ReportPeriod } from "@/lib/reporting";

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range" },
];

export function ReportFilters({
  action,
  filters,
  categories,
  members,
  currencies,
}: {
  action: string;
  filters: Filters;
  categories: { id: string; name: string; status: string }[];
  members: { id: string; name: string; removed: boolean }[];
  currencies: string[];
}) {
  const [period, setPeriod] = useState(filters.period);
  const options = [...new Set([...currencies, ...(filters.currency ? [filters.currency] : [])])].sort();

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" method="get">
      <label className="text-sm font-medium text-slate-700">
        Report period
        <Select className="mt-1" name="period" onChange={(event) => setPeriod(event.target.value as ReportPeriod)} value={period}>
          {PERIODS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </label>
      <label className="text-sm font-medium text-slate-700">
        Vendor
        <Input className="mt-1" defaultValue={filters.vendor} maxLength={120} name="vendor" placeholder="Search by vendor" />
      </label>
      <label className="text-sm font-medium text-slate-700">
        Category
        <Select className="mt-1" defaultValue={filters.categoryId ?? ""} name="categoryId">
          <option value="">All categories</option>
          {categories.map(({ id, name, status }) => (
            <option key={id} value={id}>{name}{status === "DISABLED" ? " (disabled)" : ""}</option>
          ))}
        </Select>
      </label>
      <label className="text-sm font-medium text-slate-700">
        Paid by
        <Select className="mt-1" defaultValue={filters.memberUserId ?? ""} name="memberUserId">
          <option value="">All members</option>
          {members.map(({ id, name, removed }) => (
            <option key={id} value={id}>{name}{removed ? " (removed)" : ""}</option>
          ))}
        </Select>
      </label>
      {period === "custom" && (
        <>
          <label className="text-sm font-medium text-slate-700">
            From
            <Input className="mt-1" defaultValue={filters.fromDate} name="fromDate" required type="date" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            To
            <Input className="mt-1" defaultValue={filters.toDate} name="toDate" required type="date" />
          </label>
        </>
      )}
      <label className="text-sm font-medium text-slate-700">
        Sort expenses
        <Select className="mt-1" defaultValue={filters.sort ?? "date-desc"} name="sort">
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="amount-desc">Highest amount first</option>
          <option value="amount-asc">Lowest amount first</option>
        </Select>
      </label>
      {options.length > 0 && (
        <label className="text-sm font-medium text-slate-700">
          Currency
          <Select className="mt-1" defaultValue={filters.currency ?? ""} name="currency">
            <option value="">All currencies</option>
            {options.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </Select>
        </label>
      )}
      {filters.pageSize !== 10 && <input name="pageSize" type="hidden" value={filters.pageSize} />}
      <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-4">
        <Button type="submit">Run report</Button>
        <ButtonLink href={action} variant="secondary">Reset filters</ButtonLink>
      </div>
    </form>
  );
}
