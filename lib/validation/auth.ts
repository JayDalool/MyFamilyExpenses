import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").transform((value) => value.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
