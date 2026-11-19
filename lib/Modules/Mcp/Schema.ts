import { z } from "zod";

export const MCP_MAX_PAGE_SIZE = 100;
export const MCP_DEFAULT_PAGE_SIZE = 20;

export const paginationInputSchema = {
  page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  pageSize: z.number().int().min(1).max(MCP_MAX_PAGE_SIZE).optional(),
};

export type McpPaginationInput = {
  page?: number;
  pageSize?: number;
};

export type McpPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  hasNextPage: boolean;
};

export type McpPageResult<T> = {
  items: T[];
  pagination: McpPagination;
};

export function normalizeMcpPagination(
  input: McpPaginationInput = {},
): Pick<McpPagination, "page" | "pageSize"> {
  const page =
    Number.isInteger(input.page) && input.page && input.page > 0
      ? input.page
      : 1;
  const pageSize =
    Number.isInteger(input.pageSize) && input.pageSize && input.pageSize > 0
      ? Math.min(input.pageSize, MCP_MAX_PAGE_SIZE)
      : MCP_DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}

export function toMcpPageResult<T>(
  items: T[],
  total: number,
  input: McpPaginationInput = {},
): McpPageResult<T> {
  const { page, pageSize } = normalizeMcpPagination(input);
  const totalItems = total;
  return {
    items,
    pagination: {
      page,
      pageSize,
      totalItems,
      hasNextPage: page * pageSize < totalItems,
    },
  };
}

export function paginateMcpItems<T>(
  items: T[],
  input: McpPaginationInput = {},
): McpPageResult<T> {
  const { page, pageSize } = normalizeMcpPagination(input);
  const start = (page - 1) * pageSize;
  return toMcpPageResult(items.slice(start, start + pageSize), items.length, {
    page,
    pageSize,
  });
}
