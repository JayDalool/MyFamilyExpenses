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
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
  expiresInDays: z.coerce.number().int().min(1).max(30),
  maxUses: z.coerce.number().int().min(1).max(100),
});

export const updateMembershipSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
});
