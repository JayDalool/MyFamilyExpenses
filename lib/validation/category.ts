import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, "Category name must be at least 2 characters").max(80, "Category name is too long"),
});

export const updateCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Category name must be at least 2 characters")
      .max(80, "Category name is too long")
      .optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((data) => data.name || data.status || data.sortOrder !== undefined, {
    message: "Provide at least one category field to update.",
  });
