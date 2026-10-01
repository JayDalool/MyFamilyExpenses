import type { HouseholdKind, HouseholdRole } from "@prisma/client";

// Display names for roles. MEMBER is called "Employee" in a company household.
export function roleLabel(role: HouseholdRole, kind: HouseholdKind): string {
  switch (role) {
    case "OWNER":
      return "Owner";
    case "ADMIN":
      return "Admin";
    case "MEMBER":
      return kind === "COMPANY" ? "Employee" : "Member";
    case "VIEWER":
      return "Viewer";
    case "ACCOUNTANT":
      return "Accountant";
  }
}
