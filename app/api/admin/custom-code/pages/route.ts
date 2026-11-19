import { NextResponse } from "next/server";

import {
  customCodeApiError,
  getCustomCodeApiContext,
} from "@/lib/Modules/CustomCode/Api";
import { listScopePagesQuerySchema } from "@/lib/Modules/CustomCode/Schema";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";

/**
 * Páginas do escopo de um script, no DTO mínimo `{ id, title, slug }`: busca paginada
 * (`q`, `page`, `pageSize`) ou resolução por id (`ids=a,b,c`, para nomear as páginas já
 * selecionadas fora da lista carregada e na comparação de versões). Com `ids` não há
 * paginação: `q`/`page`/`pageSize` são ignorados. Página na lixeira nunca volta.
 */
export async function GET(request: Request) {
  const context = await getCustomCodeApiContext(request);
  if (!context)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  try {
    const query = listScopePagesQuerySchema.parse({
      q: params.get("q") ?? undefined,
      ids: params.get("ids") ?? undefined,
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
    });
    const pages = await customCodeService.listScopePages(
      query.ids
        ? { ids: query.ids }
        : { search: query.q, page: query.page, pageSize: query.pageSize },
    );
    return NextResponse.json(pages);
  } catch (error) {
    return customCodeApiError(error);
  }
}
