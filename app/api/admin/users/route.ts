import { NextResponse } from "next/server";

import {
  getUsersApiContext,
  usersApiError,
  usersApiForbidden,
} from "@/lib/Modules/Users/Api";
import { usersListSchema } from "@/lib/Modules/Users/Schema";
import { usersService } from "@/lib/Modules/Users/Service";
import { UsersDomainError } from "@/lib/Modules/Users/Types";

export async function GET(request: Request) {
  const apiContext = await getUsersApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (apiContext.role === "EDITOR") return usersApiForbidden();

  try {
    const url = new URL(request.url);
    const parsed = usersListSchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsed.success) {
      throw new UsersDomainError("VALIDATION_ERROR", "Invalid user data");
    }
    return NextResponse.json({
      users: await usersService.listUsers(apiContext.userId, parsed.data),
    });
  } catch (error) {
    return usersApiError(error);
  }
}
