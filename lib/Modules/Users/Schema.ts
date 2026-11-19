import { z } from "zod";

export const editableUserRoleSchema = z.enum(["ADMIN", "EDITOR"]);

export const createInviteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: editableUserRoleSchema,
  })
  .strict();

export const acceptInviteSchema = z
  .object({
    email: z
      .string()
      .trim()
      .pipe(z.email())
      .transform((value) => value.toLowerCase()),
    password: z.string().min(8),
  })
  .strict();

/** PATCH de usuário: name e/ou email e/ou role (pelo menos um). */
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z
      .string()
      .trim()
      .pipe(z.email())
      .transform((value) => value.toLowerCase())
      .optional(),
    role: editableUserRoleSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.email !== undefined ||
      value.role !== undefined,
    { message: "At least one field is required" },
  );

/** @deprecated alias — use updateUserSchema (ainda aceita só { role }). */
export const changeUserRoleSchema = updateUserSchema;

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8),
  })
  .strict();

export const usersListSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangeUserRoleInput = UpdateUserInput;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UsersListInput = z.infer<typeof usersListSchema>;
