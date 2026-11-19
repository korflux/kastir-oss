import { prisma } from "@/lib/prisma";
import type { AutomaticNotificationDatabase } from "@/lib/SideEffects/Types";

export async function getAutomaticNotificationRecipientIds(
  database: AutomaticNotificationDatabase = prisma as unknown as AutomaticNotificationDatabase,
): Promise<string[]> {
  const users = await database.user.findMany({
    where: {
      OR: [{ isMaster: true }, { role: "ADMIN" }],
    },
    select: { id: true },
  });

  return [...new Set(users.map((user) => user.id))];
}
