import { z } from "zod";

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
