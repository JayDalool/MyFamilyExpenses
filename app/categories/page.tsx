import { AppShell } from "@/components/app-shell";
import { CategoryForm } from "@/components/category-form";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export default async function CategoriesPage() {
  const user = await requireAdmin();
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <AppShell user={user}>
      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <CategoryForm />

        <section className="rounded-3xl bg-white p-6 shadow-soft">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold text-slate-900">Categories</h1>
            <p className="text-sm text-slate-500">Manage the list used when family members save expenses.</p>
          </div>

          <div className="space-y-3">
            {categories.map((category) => (
              <div
                className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-4"
                key={category.id}
              >
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
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
