const API_BASE_URL = import.meta.env["VITE_API_BASE_URL"] as string | undefined;

if (!API_BASE_URL) {
  // Fail fast in dev rather than silently calling a wrong/relative URL.
  // eslint-disable-next-line no-console
  console.error("VITE_API_BASE_URL is not set — copy .env.example to .env.local");
}

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  /**
   * Permission named by a 403 "Missing permission: x" message, else null.
   * The backend exposes it only in that text today (DECISION-011 asks for a
   * structured field); null means "unknown", never guessed.
   */
  readonly missingPermission: string | null;
  /**
   * Machine-readable code: `payload.code` (root of the body) or `payload.error.code`,
   * else the leading `UPPER_SNAKE:` token of the message (the double
   * confirmation 409 is sent that way: "GOVERNANCE_CONFIRMATION_REQUIRED: ..."),
   * else null. Never guessed from the status.
   */
  readonly code: string | null;

  constructor(message: string, status: number, requestId: string | null, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
    this.code = code ?? /^([A-Z][A-Z0-9_]{2,}):/.exec(message)?.[1] ?? null;
    this.missingPermission = status === 403 ? (/^Missing permission: (\S+)$/.exec(message)?.[1] ?? null) : null;
  }
}

/** Second confirmation resent with the same request after a 409 (backend GovernanceConfirmationBody). */
export interface GovernanceConfirmation { rule: "noSelfValidation"; reason: string }

/** q142, display only: set by the server on validated objects. */
export type ValidationIndependence = "INDEPENDENT" | "WITHOUT_INDEPENDENT_REVIEW" | "REVIEWED_BY_THIRD_PARTY";

export const GOVERNANCE_CONFIRMATION_REQUIRED = "GOVERNANCE_CONFIRMATION_REQUIRED";

/** True for the 409 that asks the caller to resend with a governanceConfirmation (dialog: lot F2). */
export function isGovernanceConfirmationRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === GOVERNANCE_CONFIRMATION_REQUIRED;
}

/** Success response with the envelope parts `apiRequest` drops. */
export interface ApiResponse<T> {
  data: T;
  status: number;
  /** Set on a 202: the change waits for a second person (e.g. PUT /config/self-validation-policy). */
  pendingRequest?: unknown;
}

type DeniedListener = (permission: string) => void;
let deniedListener: DeniedListener | null = null;

/** Single subscriber (the app-level dialog). Returns an unsubscribe function. */
export function onPermissionDenied(listener: DeniedListener): () => void {
  deniedListener = listener;
  return () => {
    if (deniedListener === listener) deniedListener = null;
  };
}

type RequestOptions = { method?: string; body?: unknown; token: string; headers?: Record<string, string> };

/**
 * Thin HTTP client. No business logic here — it only shapes requests and
 * unwraps responses. Every business decision (validation, transitions,
 * permissions) happens on the backend (see ADR-001 principle #1).
 */
export async function apiRequestFull<T>(path: string, options: RequestOptions): Promise<ApiResponse<T>> {
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
    const raw: unknown = payload.error;
    const structured = raw !== null && typeof raw === "object" ? (raw as { code?: unknown; message?: unknown }) : null;
    const message = structured ? (typeof structured.message === "string" ? structured.message : "Request failed") : typeof raw === "string" ? raw : "Request failed";
    // The backend sends `code` at the root of the body; `error.code` is kept as a fallback.
    const code = typeof payload.code === "string" ? payload.code : structured && typeof structured.code === "string" ? structured.code : null;
    const error = new ApiError(message, res.status, requestId, code);
    // Refused write (F-B8-06): tell the dialog. GETs are excluded because several
    // screens deliberately degrade on a 403 (directory lookups) without alarming the user.
    if (error.missingPermission && (options.method ?? "GET") !== "GET") deniedListener?.(error.missingPermission);
    throw error;
  }

  if (res.status === 204) return { data: undefined as T, status: 204 };
  const payload = await res.json();
  return { data: payload.data as T, status: res.status, ...(payload.pendingRequest !== undefined ? { pendingRequest: payload.pendingRequest } : {}) };
}

/** Same as `apiRequestFull` but returns only `data` (the common case). */
export async function apiRequest<T>(path: string, options: RequestOptions): Promise<T> {
  return (await apiRequestFull<T>(path, options)).data;
}
