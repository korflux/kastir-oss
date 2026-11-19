import { z } from "zod";

/** Shared client/server login input. Min length matches Better Auth config. */
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export type LoginInput = z.infer<typeof loginSchema>;
