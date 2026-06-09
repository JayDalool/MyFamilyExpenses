import { AppShell } from "@/components/app-shell";
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
          <div className="mb-4">
            <h1 className="text-2xl font-semibold text-slate-900">Categories</h1>
            <p className="text-sm text-slate-500">Manage the list used when family members save expenses.</p>
          </div>

          <div className="space-y-3">
            {categories.map((category) => (
              <div
                className="rounded-2xl border border-slate-200 px-4 py-4"
                key={category.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{category.name}</p>
                    <p className="text-sm text-slate-500">Sort order: {category.sortOrder}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      category.status === "ACTIVE"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {category.status}
                  </span>
                </div>
                {canManage ? <CategoryActions category={category} /> : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
