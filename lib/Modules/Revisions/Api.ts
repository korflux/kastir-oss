/**
 * Fronteira HTTP das consultas de revisão. Erro genérico; sem conteúdo
 * integral, stack ou segredo na resposta.
 */
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { pageApiError } from "@/lib/Modules/Pages/Api";
import { customCodeApiError } from "@/lib/Modules/CustomCode/Api";
import { PagesDomainError } from "@/lib/Modules/Pages/Types";
import { CustomCodeDomainError } from "@/lib/Modules/CustomCode/Types";
import {
  RevisionService,
  type RevisionDatabase,
} from "@/lib/Modules/Revisions/Service";
import { RevisionsDomainError } from "@/lib/Modules/Revisions/Types";

const statusByError: Record<RevisionsDomainError["code"], number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
};

export function revisionService(): RevisionService {
  return new RevisionService(prisma as unknown as RevisionDatabase);
}

export function revisionApiError(error: unknown): NextResponse {
  if (error instanceof RevisionsDomainError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: statusByError[error.code] },
    );
  }
  if (error instanceof PagesDomainError) return pageApiError(error);
  if (error instanceof CustomCodeDomainError) return customCodeApiError(error);
  return NextResponse.json(
    {
      error: "Unable to complete the revision operation",
      code: "INTERNAL_ERROR",
    },
    { status: 500 },
  );
}
