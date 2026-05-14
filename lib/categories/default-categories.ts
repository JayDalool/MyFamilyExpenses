export const DEFAULT_CATEGORY_NAMES = [
  "Restaurant",
  "Travel",
  "Education",
  "Groceries",
  "Utilities",
  "Medical",
  "Transportation",
  "Household",
  "Entertainment",
  "Personal",
  "Miscellaneous",
] as const;

export function buildDefaultCategories(householdId: string) {
  return DEFAULT_CATEGORY_NAMES.map((name, index) => ({
    householdId,
    name,
    sortOrder: index,
    status: "ACTIVE" as const,
  }));
}
