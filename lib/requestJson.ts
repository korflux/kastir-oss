export type ApiError = Error & { code?: string };

export async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    const error = new Error(payload?.error ?? "Request failed") as ApiError;
    error.code = payload?.code;
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
