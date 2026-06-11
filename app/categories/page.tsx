import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui";
import { CategoryForm } from "@/components/category-form";
import { CategoryActions } from "@/components/category-actions";
import { requireHouseholdMember } from "@/lib/auth/session";
import { canManageCategories } from "@/lib/auth/permissions";
import { getRequestCsrfToken } from "@/lib/auth/csrf-server";
import { prisma } from "@/lib/db/prisma";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const CATEGORY_ERRORS: Record<string, string> = {
  category_invalid: "Enter a valid category name.",
  category_exists: "Category already exists.",
  category_forbidden: "Admin access required.",
};

export default async function CategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const auth = await requireHouseholdMember();

  const categories = await prisma.category.findMany({
    where: { householdId: auth.householdId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const initialError = errorKey ? (CATEGORY_ERRORS[errorKey] ?? "Unable to create category.") : null;
  const initialSuccess = params.status === "created" ? "Category created." : null;
  const csrfToken = await getRequestCsrfToken();
  const canManage = canManageCategories(auth);

  return (
    <AppShell auth={auth}>
      <div className={`grid gap-6 ${canManage ? "lg:grid-cols-[360px,1fr]" : ""}`}>
        {canManage ? (
          <CategoryForm
            csrfToken={csrfToken}
            initialError={initialError}
            initialSuccess={initialSuccess}
          />
        ) : null}

        <section className="rounded-3xl bg-white p-6 shadow-soft">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Categories</h1>
              <p className="text-sm text-slate-500">Manage the list used when family members save expenses.</p>
            </div>
            <p className="whitespace-nowrap text-sm text-slate-400">
              {categories.length} total
            </p>
          </div>

          {categories.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-slate-600">No categories yet.</p>
              <p className="mt-1 text-sm text-slate-500">
                {canManage
                  ? "Add your first category with the form on this page."
                  : "Ask a household owner or admin to add categories."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {categories.map((category) => (
                <li
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                  key={category.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <p className="truncate font-medium text-slate-900">{category.name}</p>
                    <Badge variant={category.status === "ACTIVE" ? "success" : "neutral"}>
                      {category.status === "ACTIVE" ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                  {canManage ? <CategoryActions category={category} /> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
