import { z } from "zod";

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .email("Enter a valid email address")
    .transform((value) => value.toLowerCase())
    .optional(),
);

export const inviteTokenSchema = z.string().trim().min(32).max(200);

export const createHouseholdInviteSchema = z.object({
  email: optionalEmail,
  householdId: z.string().uuid().optional(),
  role: z.enum(["ADMIN", "MEMBER", "ACCOUNTANT", "VIEWER"]),
  expiresInDays: z.coerce.number().int().min(1).max(30),
  maxUses: z.coerce.number().int().min(1).max(100),
}).superRefine((invite, context) => {
  if (invite.role !== "ACCOUNTANT") return;
  if (!invite.email) {
    context.addIssue({ code: "custom", path: ["email"], message: "Enter the accountant’s email address." });
  }
  if (invite.maxUses !== 1) {
    context.addIssue({ code: "custom", path: ["maxUses"], message: "An accountant invitation can only be used once." });
  }
  if (!invite.householdId) {
    context.addIssue({ code: "custom", path: ["householdId"], message: "Select the workspace for this invitation." });
  }
});

export const updateMembershipSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "ACCOUNTANT", "VIEWER"]),
});
