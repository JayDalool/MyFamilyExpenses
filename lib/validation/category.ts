import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, "Category name must be at least 2 characters").max(80, "Category name is too long"),
});
