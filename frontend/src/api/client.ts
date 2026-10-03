const API_BASE_URL = import.meta.env["VITE_API_BASE_URL"] as string | undefined;

if (!API_BASE_URL) {
  // Fail fast in dev rather than silently calling a wrong/relative URL.
  // eslint-disable-next-line no-console
  console.error("VITE_API_BASE_URL is not set — copy .env.example to .env.local");
}

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;

  constructor(message: string, status: number, requestId: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * Thin HTTP client. No business logic here — it only shapes requests and
 * unwraps responses. Every business decision (validation, transitions,
 * permissions) happens on the backend (see ADR-001 principle #1).
 */
export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; token: string; headers?: Record<string, string> } ,
): Promise<T> {
  const res = await fetch(`${API_BASE_URL ?? ""}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.token}`,
      ...(options.headers ?? {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const requestId = res.headers.get("X-Request-Id");

  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(payload.error ?? "Request failed", res.status, requestId);
  }

  if (res.status === 204) return undefined as T;
  const payload = await res.json();
  return payload.data as T;
}
